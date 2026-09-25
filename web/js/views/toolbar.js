// Bottom toolbar: tools, brush sizes and the color palette, filtered by AppConfig.

import { TOOLS, COLORS, SIZES, PALETTES, colorCss } from '../config.js';
import { icon } from '../icons.js';

export class ToolbarView {
  constructor({ tools, sizes, palettes, colors, brush }, vm) {
    this.els = { tools, sizes, palettes, colors, brush };
    this.vm = vm;
    vm.addEventListener('change', () => this.render());
    this.render();
  }

  render() {
    const { vm } = this;
    const { visibleTools, visibleColors } = vm.config;
    const brushColor = colorCss(vm.color, vm.palette);

    this.els.tools.replaceChildren(
      ...TOOLS.filter((t) => visibleTools.includes(t.id)).map((t) =>
        button({
          className: 'tool',
          pressed: vm.tool === t.id,
          label: t.label,
          html: `<span class="icon" aria-hidden="true">${icon(t.id)}</span><span class="caption">${t.label}</span>`,
          onClick: () => vm.setTool(t.id),
        }),
      ),
      // The phone layout's Brush button, which opens sizes and palettes; hidden elsewhere.
      this.els.brush,
    );
    const size = SIZES.find((s) => s.id === vm.size) ?? SIZES[0];
    const dot = this.els.brush.querySelector('.brush-dot');
    dot.style.width = dot.style.height = `${Math.round(10 + (size.px / 40) * 14)}px`;
    dot.style.background = brushColor;

    // Size doesn't apply to the paint bucket.
    this.els.sizes.hidden = vm.tool === 'fill';
    this.els.sizes.replaceChildren(
      ...SIZES.map((s) => {
        const dot = Math.round(8 + (s.px / 40) * 22);
        return button({
          className: 'size',
          pressed: vm.size === s.id,
          label: `${s.label} brush`,
          html: `<span class="dot" style="width:${dot}px;height:${dot}px;background:${brushColor}"></span>`,
          onClick: () => vm.setSize(s.id),
        });
      }),
    );

    // Palette picker: each button shows four of its colors, so it reads without words.
    this.els.palettes.replaceChildren(
      ...PALETTES.map((p) =>
        button({
          className: 'palette',
          pressed: vm.palette === p.id,
          label: p.label,
          html: p.preview
            .map((id) => `<span class="palette-dot" style="background:${p.colors[id]}"></span>`)
            .join(''),
          onClick: () => vm.setPalette(p.id),
        }),
      ),
    );

    this.els.colors.replaceChildren(
      ...COLORS.filter((c) => visibleColors.includes(c.id)).map((c) => {
        const b = button({
          className: 'swatch',
          pressed: vm.color === c.id,
          label: c.label,
          onClick: () => vm.setColor(c.id),
        });
        b.style.setProperty('--swatch', colorCss(c.id, vm.palette));
        return b;
      }),
    );
  }
}

function button({ className, pressed, label, html = '', onClick }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('aria-pressed', String(pressed));
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = html;
  b.addEventListener('click', onClick);
  return b;
}
