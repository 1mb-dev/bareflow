# Resizing/styling a marker image set via `list-image-[url(...)]`

No documentation file was attached for this question, so all claims below are marked [memory] (from general knowledge, not a supplied doc).

## Why Tailwind's size utilities don't work here

- `list-image-[url(...)]` is Tailwind's arbitrary-value utility for the CSS `list-style-image` property. [memory]
- What actually paints the bullet/number/image is the `::marker` pseudo-element, and per the CSS Lists spec `::marker` only accepts a restricted allow-list of properties: `color`, `content`, `direction`, `font` (and its longhands), `text-combine-upright`, `unicode-bidi`, `white-space`, plus animation/transition-related properties. [memory]
- `width`, `height`, `background-size`, `object-fit`, etc. are **not** on that allow-list. Any Tailwind utility that compiles to one of those properties (`w-*`, `h-*`, `size-*`, `object-contain`, ...) is therefore inert when applied to a marker — the browser silently ignores the declaration rather than erroring, which is why it looks like "Tailwind doesn't support this" but is really a CSS spec limitation. [memory]
- Tailwind does have a `marker:` variant (added in v3.4) for targeting `::marker` directly, but it only exposes utilities for the same limited property set (mainly color and font/typography) — it cannot size an image either. [memory]
- Net effect: once an image is installed as a `list-style-image` marker, its rendered size is fixed at the image's intrinsic dimensions. There is no standard CSS override to rescale it in place. [memory]

## Practical options

### 1. Pre-size the source asset (stay on `list-image-[...]`)
If you want to keep using `list-style-image`/`list-image-[...]`, bake the target display size into the file itself — export the icon as e.g. a 16x16 PNG, or set explicit `width`/`height` attributes on the SVG. Since CSS can't rescale the marker, this is the only way to control size while keeping this mechanism.

```html
<ul class="list-image-[url('/icons/check-16.svg')] list-inside space-y-1">
  <li>Shipped the thing</li>
  <li>Wrote the docs</li>
</ul>
```

### 2. Drop `list-style-image`; fake the marker with a `before:` pseudo-element
A `::before` box is an ordinary generated box, not a marker, so it accepts width/height/background-size normally — full Tailwind sizing utilities apply. This is the standard workaround when you still want semantic `<li>` markers with a custom-sized icon.

```html
<ul class="list-none space-y-2">
  <li class="relative pl-6 before:absolute before:left-0 before:top-1
             before:h-4 before:w-4 before:bg-[url('/icons/check.svg')]
             before:bg-contain before:bg-no-repeat before:content-['']">
    Shipped the thing
  </li>
  <li class="relative pl-6 before:absolute before:left-0 before:top-1
             before:h-4 before:w-4 before:bg-[url('/icons/check.svg')]
             before:bg-contain before:bg-no-repeat before:content-['']">
    Wrote the docs
  </li>
</ul>
```

- `list-none` on the `<ul>` removes the native marker box entirely.
- `before:content-['']` creates an empty pseudo-element you can then size (`before:h-4 before:w-4` or `before:size-4`), position (`relative` on the `<li>` + `before:absolute`), and fill with an image (`before:bg-[url(...)]` plus `before:bg-contain before:bg-no-repeat`).
- If this class list repeats across many `<li>`s, factor it into one place (a component class via `@apply`, or a small wrapper component) so the icon path/size is a single edit point.

### 3. Use a real `<img>`/inline SVG instead of a CSS marker
If there's no hard requirement to stay inside the marker/`list-style-image` mechanism, this is the least surprising fix — stop fighting the marker system and lay the icon out as a normal element next to the text:

```html
<ul class="space-y-2">
  <li class="flex items-start gap-2">
    <img src="/icons/check.svg" alt="" class="mt-1 size-4 shrink-0">
    <span>Shipped the thing</span>
  </li>
</ul>
```

Here `size-4` (or `w-4 h-4`) works normally because it targets a real `<img>` element, not a marker box — full Tailwind sizing, `object-contain`, hover/dark-mode variants, and alt text all work without any workaround.

## Recommendation

- Option 3 (real element in a flex row) is the most robust choice when you have any layout, accessibility (alt text), or interactive-state (hover/dark mode) needs — no workaround required.
- Option 2 (`before:` pseudo-element) is the right call when you specifically want to preserve semantic `<li>` markers and just need a custom-sized icon bullet.
- Option 1 (pre-sized asset + `list-image-[...]`) only makes sense if you must stay on the literal `list-style-image` mechanism and can control the image file's baked-in dimensions.
