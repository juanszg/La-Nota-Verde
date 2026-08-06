# LA NOTA VERDE

Base de la plataforma musical, creada con Astro y Tailwind CSS. Esta primera fase define el sistema visual, la navegación y la estructura de componentes sin implementar todavía los módulos musicales.

## Comandos

```bash
npm install
npm run dev
npm run check
npm run build
```

## Arquitectura

- `src/components/`: bloques visuales reutilizables y específicos de cada vista.
- `src/components/ui/`: primitivas de interfaz (`Button`, `Card`, selector de tema).
- `src/layouts/`: composición global, metadatos, navegación y pie de página.
- `src/data/`: contenido estático separado de los componentes.
- `src/icons/`: iconografía SVG local, sin dependencias visuales externas.
- `src/styles/`: tokens de color, tema y estilos base.
- `src/pages/`: rutas de Astro.

## Sistema visual

Los tokens de Tailwind se declaran en `src/styles/global.css`. La interfaz utiliza exclusivamente los colores de la identidad de marca y variables semánticas de superficie, texto y borde. El selector de tema persiste la preferencia en `localStorage` y activa `data-theme` en el elemento raíz.

## Siguientes fases

La arquitectura admite módulos nuevos en carpetas dedicadas (por ejemplo `src/music/`, `src/utils/` y `src/hooks/`) cuando se incorporen el editor, las lecciones y las herramientas musicales.
