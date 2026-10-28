import * as alphaTab from '@coderline/alphatab';

type Duration = 1 | 2 | 4 | 8 | 16;
type Entry = { kind: 'note'; string: number; fret: number; duration: Duration } | { kind: 'rest'; duration: Duration };
type Project = { format: 'la-nota-verde-score'; version: 1; title: string; tempo: number; events: Entry[] };
const stringMidi: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
const noteNames = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const durationNames: Record<Duration, string> = { 1: 'redonda', 2: 'blanca', 4: 'negra', 8: 'corchea', 16: 'semicorchea' };
const durationUnits: Record<Duration, number> = { 1: 16, 2: 8, 4: 4, 8: 2, 16: 1 };
const titleInput = document.querySelector<HTMLInputElement>('#score-title')!;
const tempoInput = document.querySelector<HTMLInputElement>('#score-tempo')!;
const stringInput = document.querySelector<HTMLSelectElement>('#note-string')!;
const fretInput = document.querySelector<HTMLSelectElement>('#note-fret')!;
const durationInput = document.querySelector<HTMLSelectElement>('#note-duration')!;
const list = document.querySelector<HTMLOListElement>('#note-list')!;
const count = document.querySelector<HTMLElement>('#note-count')!;
const empty = document.querySelector<HTMLElement>('#empty-sequence')!;
const status = document.querySelector<HTMLElement>('#editor-status')!;
const paperTitle = document.querySelector<HTMLElement>('#paper-title')!;
const preview = document.querySelector<HTMLElement>('#score-preview')!;
const fileInput = document.querySelector<HTMLInputElement>('#score-file')!;
const playButton = document.querySelector<HTMLButtonElement>('#play-score')!;
const addNoteButton = document.querySelector<HTMLButtonElement>('#add-note')!;
const addRestButton = document.querySelector<HTMLButtonElement>('#add-rest')!;
const cancelEditButton = document.querySelector<HTMLButtonElement>('#cancel-edit')!;
const editHint = document.querySelector<HTMLElement>('#edit-hint')!;
const entryControls = document.querySelector<HTMLElement>('#note-entry-controls')!;
const storageKey = 'lnv-score-editor-v1';

const practices: Record<string, { title: string; tempo: number; events: Entry[] }> = {
  warmup: {
    title: 'Calentamiento cromático', tempo: 76,
    events: [6, 5, 4, 3, 2, 1].flatMap((string) => [1, 2, 3, 4].map((fret) => ({ kind: 'note' as const, string, fret, duration: 4 as const }))),
  },
  pentatonic: {
    title: 'Pentatónica de La menor', tempo: 82,
    events: [[5,0],[5,3],[4,0],[4,2],[3,0],[3,2],[2,1],[2,3],[1,0],[1,3],[1,5],[1,3],[1,0],[2,3],[2,1],[3,2],[3,0],[4,2],[4,0],[5,3],[5,0]]
      .map(([string, fret], index) => ({ kind: 'note' as const, string, fret, duration: index === 10 ? 2 as const : 4 as const })),
  },
  reading: {
    title: 'Lectura en Mi mayor', tempo: 72,
    events: [
      {kind:'note',string:1,fret:0,duration:4},{kind:'note',string:1,fret:2,duration:4},
      {kind:'note',string:1,fret:4,duration:2},{kind:'note',string:1,fret:5,duration:8},
      {kind:'note',string:1,fret:7,duration:8},{kind:'note',string:1,fret:9,duration:4},
      {kind:'note',string:1,fret:11,duration:2},{kind:'note',string:1,fret:12,duration:4},
      {kind:'rest',duration:4},{kind:'note',string:1,fret:11,duration:8},
      {kind:'note',string:1,fret:9,duration:8},{kind:'note',string:1,fret:7,duration:2},
      {kind:'note',string:1,fret:5,duration:4},{kind:'note',string:1,fret:4,duration:4},
      {kind:'note',string:1,fret:2,duration:2},{kind:'note',string:1,fret:0,duration:1},
    ],
  },
};

let project: Project = { format: 'la-nota-verde-score', version: 1, title: 'Mi primera idea', tempo: 88, events: [] };
let activeScore: alphaTab.model.Score | null = null;
let imported = false;
let editingIndex: number | null = null;
let audio: AudioContext | null = null;
let renderTimer = 0;
let playTimer = 0;
const fontDirectory = new URL(import.meta.env.BASE_URL + 'font/', window.location.origin).toString();
const api = new alphaTab.AlphaTabApi(preview, { core: { useWorkers: false, fontDirectory, enableLazyLoading: false } });
api.scoreLoaded.on((score) => {
  activeScore = score;
  if (!imported) status.textContent = 'Partitura y tablatura listas. Tus cambios quedan guardados en este navegador.';
});
api.error.on((error) => { status.textContent = 'No se pudo representar el archivo: ' + error.message; });

function pitch(entry: Entry): number | null {
  return entry.kind === 'rest' ? null : (stringMidi[entry.string] ?? 64) + entry.fret;
}
function nameOf(entry: Entry): string {
  const midi = pitch(entry);
  return midi === null ? 'Silencio' : noteNames[midi % 12] + (Math.floor(midi / 12) - 1);
}
function clampDuration(value: number): Duration {
  return ([1, 2, 4, 8, 16].includes(value) ? value : 4) as Duration;
}
function addRests(target: Entry[], units: number): void {
  let left = units;
  for (const part of [16, 8, 4, 2, 1]) while (left >= part) {
    target.push({ kind: 'rest', duration: (16 / part) as Duration });
    left -= part;
  }
}
function measures(events: Entry[]): Entry[][] {
  const output: Entry[][] = [];
  let current: Entry[] = [];
  let left = 16;
  for (const event of events) {
    const units = durationUnits[event.duration];
    if (units > left) {
      addRests(current, left);
      output.push(current);
      current = [];
      left = 16;
    }
    current.push(event);
    left -= units;
    if (left === 0) {
      output.push(current);
      current = [];
      left = 16;
    }
  }
  if (current.length || !output.length) {
    addRests(current, left);
    output.push(current);
  }
  return output;
}
function texFor(data: Project): string {
  const bars = measures(data.events).map((bar) => bar.map((event) =>
    event.kind === 'rest' ? 'r.' + event.duration : event.fret + '.' + event.string + '.' + event.duration,
  ).join(' '));
  const escapedTitle = (data.title || 'Sin título').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
  return [
    '\\title "' + escapedTitle + '"',
    '\\tempo ' + Math.min(220, Math.max(40, data.tempo || 88)),
    '\\ts 4 4',
    '\\track "Guitarra"',
    '\\staff { score tabs }',
    '\\tuning (E4 B3 G3 D3 A2 E2)',
    bars.join(' | '),
  ].join('\n');
}
function saveLocal(): void {
  try { localStorage.setItem(storageKey, JSON.stringify(project)); }
  catch { status.textContent = 'No se pudo guardar automáticamente; usa “Guardar proyecto” para descargar el archivo.'; }
}
function describe(event: Entry): string {
  if (event.kind === 'rest') return durationNames[event.duration] + ' · silencio';
  const strings: Record<number, string> = { 1:'1.ª Mi',2:'2.ª Si',3:'3.ª Sol',4:'4.ª Re',5:'5.ª La',6:'6.ª Mi' };
  return nameOf(event) + ' · ' + strings[event.string] + ' traste ' + event.fret + ' · ' + durationNames[event.duration];
}
function eventPositions(events: Entry[]): { measure: number; offset: number }[] {
  let measure = 1;
  let offset = 0;
  return events.map((event) => {
    const units = durationUnits[event.duration];
    if (units > 16 - offset) { measure += 1; offset = 0; }
    const position = { measure, offset };
    offset += units;
    if (offset === 16) { measure += 1; offset = 0; }
    return position;
  });
}
function positionLabel(position: { measure: number; offset: number }): string {
  const beat = Math.floor(position.offset / 4) + 1;
  const fraction = position.offset % 4;
  const suffix = fraction === 1 ? ' + ¼' : fraction === 2 ? ' + ½' : fraction === 3 ? ' + ¾' : '';
  return 'Compás ' + position.measure + ' · tiempo ' + beat + suffix;
}
function syncEditControls(): void {
  const editing = editingIndex !== null && project.events[editingIndex] !== undefined;
  if (!editing) editingIndex = null;
  addNoteButton.textContent = editing ? '✓ Guardar como nota' : '＋ Añadir nota';
  addRestButton.textContent = editing ? '✓ Guardar como silencio' : '＋ Añadir silencio';
  cancelEditButton.classList.toggle('hidden', !editing);
  if (editing && editingIndex !== null) {
    const position = eventPositions(project.events)[editingIndex];
    editHint.textContent = 'Editando ' + positionLabel(position) + '. Ajusta cuerda, traste o duración y guarda.';
  } else {
    editHint.textContent = 'Elige cuerda y traste; la nota se calcula automáticamente.';
  }
}
function drawList(): void {
  list.replaceChildren();
  count.textContent = project.events.length + (project.events.length === 1 ? ' elemento' : ' elementos');
  empty.classList.toggle('hidden', project.events.length > 0);
  const positions = eventPositions(project.events);
  project.events.forEach((event, index) => {
    const row = document.createElement('li');
    row.className = 'rounded-lg border border-[var(--border)] bg-[var(--control-surface)] px-3 py-2' + (editingIndex === index ? ' is-editing' : '');
    const label = document.createElement('span');
    label.className = 'min-w-0 flex-1 text-[9px] leading-4 text-[var(--text-primary)]';
    const location = document.createElement('strong');
    location.className = 'block text-[var(--accent)]';
    location.textContent = String(index + 1).padStart(2, '0') + ' · ' + positionLabel(positions[index]);
    const detail = document.createElement('span');
    detail.className = 'block';
    detail.textContent = describe(event);
    label.append(location, detail);

    const actions = document.createElement('div');
    actions.className = 'sequence-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'shrink-0 rounded-md border border-neon/30 px-2 py-1 text-[9px] font-bold text-[var(--accent)] transition hover:bg-neon/10';
    edit.textContent = editingIndex === index ? 'Editando' : 'Editar';
    edit.setAttribute('aria-label', 'Editar elemento ' + (index + 1) + ', ' + positionLabel(positions[index]));
    edit.addEventListener('click', () => {
      editingIndex = index;
      const selected = project.events[index];
      durationInput.value = String(selected.duration);
      if (selected.kind === 'note') {
        stringInput.value = String(selected.string);
        fretInput.value = String(selected.fret);
      }
      render();
      status.textContent = 'Editando ' + positionLabel(eventPositions(project.events)[index]) + '. Cambia los controles y guarda la nota o silencio.';
      entryControls.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      durationInput.focus({ preventScroll: true });
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'shrink-0 rounded-md px-2 py-1 text-[9px] text-[var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-400';
    remove.textContent = 'Quitar';
    remove.setAttribute('aria-label', 'Quitar elemento ' + (index + 1) + ', ' + positionLabel(positions[index]));
    remove.addEventListener('click', () => {
      project.events.splice(index, 1);
      if (editingIndex === index) editingIndex = null;
      else if (editingIndex !== null && editingIndex > index) editingIndex -= 1;
      render();
      status.textContent = 'Elemento eliminado de ' + positionLabel(positions[index]) + '.';
    });
    actions.append(edit, remove);
    row.append(label, actions);
    list.append(row);
  });
}
function render(): void {
  project.title = titleInput.value.trim().slice(0, 80) || 'Sin título';
  project.tempo = Math.min(220, Math.max(40, Number(tempoInput.value) || 88));
  titleInput.value = project.title;
  tempoInput.value = String(project.tempo);
  paperTitle.textContent = project.title;
  syncEditControls();
  drawList();
  saveLocal();
  imported = false;
  activeScore = null;
  try { api.tex(texFor(project)); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo generar la partitura.'; }
}
function scheduleRender(): void {
  window.clearTimeout(renderTimer);
  project.title = titleInput.value.slice(0, 80) || 'Sin título';
  project.tempo = Math.min(220, Math.max(40, Number(tempoInput.value) || 88));
  paperTitle.textContent = project.title;
  saveLocal();
  renderTimer = window.setTimeout(render, 180);
}
function loadPractice(id: string): void {
  const practice = practices[id];
  if (!practice) return;
  editingIndex = null;
  project = { format: 'la-nota-verde-score', version: 1, title: practice.title, tempo: practice.tempo, events: practice.events.map((event) => ({ ...event })) };
  titleInput.value = project.title;
  tempoInput.value = String(project.tempo);
  render();
  status.textContent = 'Práctica cargada. Puedes editar cada nota y escuchar la secuencia.';
}
function addEntry(kind: 'note' | 'rest'): void {
  if (editingIndex === null && project.events.length >= 256) {
    status.textContent = 'La práctica alcanzó el límite de 256 elementos. Guarda el proyecto y continúa en otro.';
    return;
  }
  const duration = clampDuration(Number(durationInput.value));
  const event: Entry = kind === 'rest'
    ? { kind: 'rest', duration }
    : { kind: 'note', string: Number(stringInput.value), fret: Number(fretInput.value), duration };
  if (editingIndex !== null && project.events[editingIndex] !== undefined) {
    const position = eventPositions(project.events)[editingIndex];
    project.events[editingIndex] = event;
    editingIndex = null;
    render();
    status.textContent = positionLabel(position) + ' actualizado: ' + describe(event) + '.';
    return;
  }
  project.events.push(event);
  render();
  status.textContent = describe(event) + ' añadida.';
}
function filename(title: string, extension: string): string {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'mi-practica';
  return base + '.' + extension;
}
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importOwn(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('El archivo no tiene un proyecto de La Nota Verde.');
  const source = value as Partial<Project>;
  if (source.format !== 'la-nota-verde-score' || source.version !== 1 || !Array.isArray(source.events)) {
    throw new Error('Formato no reconocido. Abre un proyecto .lnv.json guardado desde Escribe.');
  }
  const events = source.events.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('El proyecto contiene un elemento inválido.');
    const entry = item as Partial<Entry>;
    const duration = clampDuration(Number(entry.duration));
    if (entry.kind === 'rest') return { kind: 'rest', duration } as Entry;
    if (entry.kind === 'note') {
      const string = Number(entry.string);
      const fret = Number(entry.fret);
      if (!Number.isInteger(string) || string < 1 || string > 6 || !Number.isInteger(fret) || fret < 0 || fret > 24) throw new Error('El proyecto contiene una cuerda o traste inválido.');
      return { kind: 'note', string, fret, duration } as Entry;
    }
    throw new Error('El proyecto contiene un tipo de elemento inválido.');
  });
  project = {
    format: 'la-nota-verde-score', version: 1,
    title: typeof source.title === 'string' ? source.title.slice(0, 80) : 'Práctica importada',
    tempo: Math.min(220, Math.max(40, Number(source.tempo) || 88)),
    events,
  };
  titleInput.value = project.title;
  tempoInput.value = String(project.tempo);
  render();
  status.textContent = 'Proyecto cargado. Ya puedes continuar editándolo.';
}
function xmlPitch(midi: number): string {
  const steps = [
    ['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],['G',0],['G',1],['A',0],['A',1],['B',0],
  ];
  const current = steps[midi % 12];
  return '<pitch><step>' + current[0] + '</step>' + (current[1] ? '<alter>' + current[1] + '</alter>' : '') + '<octave>' + (Math.floor(midi / 12) - 1) + '</octave></pitch>';
}
function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function musicXml(data: Project): string {
  const type: Record<Duration, string> = { 1:'whole',2:'half',4:'quarter',8:'eighth',16:'16th' };
  const bars = measures(data.events).map((bar, index) => {
    const attributes = index === 0
      ? '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'
      : '';
    const tempo = index === 0
      ? '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + data.tempo + '</per-minute></metronome></direction-type><sound tempo="' + data.tempo + '"/></direction>'
      : '';
    const notes = bar.map((entry) => {
      const body = entry.kind === 'rest' ? '<rest/>' : xmlPitch(pitch(entry)!);
      const technique = entry.kind === 'note'
        ? '<notations><technical><string>' + entry.string + '</string><fret>' + entry.fret + '</fret></technical></notations>'
        : '';
      return '<note>' + body + '<duration>' + durationUnits[entry.duration] + '</duration><voice>1</voice><type>' + type[entry.duration] + '</type><staff>1</staff>' + technique + '</note>';
    }).join('');
    return '<measure number="' + (index + 1) + '">' + attributes + tempo + notes + '</measure>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="4.0"><work><work-title>' + xmlEscape(data.title) + '</work-title></work><identification><creator type="composer">La Nota Verde</creator></identification>' +
    '<part-list><score-part id="P1"><part-name>Guitarra</part-name><score-instrument id="P1-I1"><instrument-name>Guitar</instrument-name></score-instrument></score-part></part-list>' +
    '<part id="P1">' + bars + '</part></score-partwise>';
}
function exportGp(): void {
  if (!activeScore) { status.textContent = 'La partitura todavía se está generando. Intenta otra vez en un momento.'; return; }
  try {
    const bytes = new alphaTab.exporter.Gp7Exporter().export(activeScore, api.settings);
    const fileBytes = new Uint8Array(bytes);
    download(new Blob([fileBytes.buffer], { type: 'application/octet-stream' }), filename(project.title, 'gp'));
    status.textContent = 'Archivo Guitar Pro 7+ exportado.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo exportar Guitar Pro.'; }
}
function exportTex(): void {
  if (!activeScore) { status.textContent = 'La partitura todavía se está generando. Intenta otra vez en un momento.'; return; }
  try {
    const text = new alphaTab.exporter.AlphaTexExporter().exportToString(activeScore, api.settings);
    download(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename(project.title, 'atex'));
    status.textContent = 'Archivo AlphaTex exportado.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo exportar AlphaTex.'; }
}
async function exportPng(): Promise<void> {
  const svgs = [...preview.querySelectorAll('svg')];
  if (!svgs.length) throw new Error('Espera a que termine de generarse la partitura y vuelve a intentarlo.');
  const images = await Promise.all(svgs.map((svg) => new Promise<{ image: HTMLImageElement; width: number; height: number }>((resolve, reject) => {
    const box = svg.viewBox.baseVal;
    const width = box.width || svg.getBoundingClientRect().width;
    const height = box.height || svg.getBoundingClientRect().height;
    if (!width || !height) return reject(new Error('La partitura no tiene dimensiones para exportar.'));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const fontStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    fontStyle.textContent = "@font-face{font-family:LNVBravura;src:url('" + fontDirectory + "Bravura.woff2') format('woff2');unicode-range:U+E000-F8FF}";
    clone.insertBefore(fontStyle, clone.firstChild);
    clone.style.fontFamily = 'LNVBravura, Arial, sans-serif';
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const image = new Image();
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
    image.onload = () => { URL.revokeObjectURL(url); resolve({ image, width, height }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El navegador no pudo convertir la partitura a imagen.')); };
    image.src = url;
  })));
  const scale = 2;
  const width = Math.ceil(Math.max(...images.map((item) => item.width)) * scale);
  const height = Math.ceil(images.reduce((total, item) => total + item.height, 0) * scale + Math.max(0, images.length - 1) * 24);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no ofrece lienzo para exportar PNG.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  let top = 0;
  for (const item of images) {
    context.drawImage(item.image, 0, top, item.width * scale, item.height * scale);
    top += item.height * scale + 24;
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No se pudo generar la imagen PNG.')), 'image/png'));
  download(blob, filename(project.title, 'png'));
  status.textContent = 'Imagen PNG exportada.';
}
async function openFile(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  imported = false;
  activeScore = null;
  if (name.endsWith('.json')) {
    importOwn(JSON.parse(await file.text()));
    return;
  }
  if (name.endsWith('.atex') || name.endsWith('.alphatex') || name.endsWith('.txt')) {
    imported = true;
    activeScore = null;
    api.tex(await file.text());
    status.textContent = 'AlphaTex abierto: ' + file.name + '.';
    return;
  }
  imported = true;
  activeScore = null;
  if (!api.load(await file.arrayBuffer())) throw new Error('No se reconoce el formato. Prueba con Guitar Pro, GPX o MusicXML.');
  status.textContent = 'Abriendo ' + file.name + '…';
}
function playEntry(entry: Entry, start: number, beatSeconds: number): void {
  if (!audio || entry.kind === 'rest') return;
  const midi = pitch(entry);
  if (midi === null) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const length = beatSeconds * durationUnits[entry.duration] / 4;
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.012);
  gain.gain.setValueAtTime(0.13, Math.max(start + 0.02, start + length - 0.04));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}
function playSequence(): void {
  if (!project.events.length) { status.textContent = 'Añade notas o carga una práctica antes de reproducir.'; return; }
  if (!window.AudioContext) { status.textContent = 'Este navegador no ofrece reproducción de audio.'; return; }
  window.clearTimeout(playTimer);
  audio ??= new AudioContext();
  void audio.resume().then(() => {
    const beat = 60 / project.tempo;
    let cursor = audio!.currentTime + 0.08;
    for (const entry of project.events) {
      playEntry(entry, cursor, beat);
      cursor += beat * durationUnits[entry.duration] / 4;
    }
    playButton.disabled = true;
    playButton.textContent = '♪ Reproduciendo…';
    playTimer = window.setTimeout(() => {
      playButton.disabled = false;
      playButton.textContent = '▶ Escuchar';
    }, Math.max(0, (cursor - audio!.currentTime) * 1000));
  }).catch(() => { status.textContent = 'No fue posible iniciar el audio.'; });
}

document.querySelectorAll<HTMLButtonElement>('[data-practice]').forEach((button) =>
  button.addEventListener('click', () => loadPractice(button.dataset.practice ?? '')),
);
addNoteButton.addEventListener('click', () => addEntry('note'));
addRestButton.addEventListener('click', () => addEntry('rest'));
cancelEditButton.addEventListener('click', () => {
  editingIndex = null;
  syncEditControls();
  drawList();
  status.textContent = 'Edición cancelada. La secuencia conserva sus notas.';
});
document.querySelector<HTMLButtonElement>('#clear-score')?.addEventListener('click', () => {
  editingIndex = null;
  project.events = [];
  render();
  status.textContent = 'La secuencia está vacía. Puedes empezar desde cero.';
});
titleInput.addEventListener('input', scheduleRender);
tempoInput.addEventListener('input', scheduleRender);
playButton.addEventListener('click', playSequence);
document.querySelector<HTMLButtonElement>('#print-score')?.addEventListener('click', () => window.print());
document.querySelector<HTMLButtonElement>('#save-project')?.addEventListener('click', () => {
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' }), filename(project.title, 'lnv.json'));
  status.textContent = 'Proyecto .lnv.json guardado para continuar editándolo.';
});
document.querySelector<HTMLButtonElement>('#load-project')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { await openFile(file); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo abrir el archivo.'; }
  finally { fileInput.value = ''; }
});
document.querySelector<HTMLButtonElement>('#export-gp')?.addEventListener('click', exportGp);
document.querySelector<HTMLButtonElement>('#export-atex')?.addEventListener('click', exportTex);
document.querySelector<HTMLButtonElement>('#export-musicxml')?.addEventListener('click', () => {
  download(new Blob([musicXml(project)], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' }), filename(project.title, 'musicxml'));
  status.textContent = 'Archivo MusicXML exportado.';
});
document.querySelector<HTMLButtonElement>('#export-png')?.addEventListener('click', () => {
  void exportPng().catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : 'No se pudo exportar la imagen.'; });
});

try {
  const cached = localStorage.getItem(storageKey);
  if (cached) importOwn(JSON.parse(cached));
  else loadPractice('warmup');
} catch { loadPractice('warmup'); }







