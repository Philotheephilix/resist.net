# Design System Rules — resist.net

ALL UI work in this project MUST follow the World UI Kit design system located in /design-system/.

## Mandatory Rules

1. **Colors**: ONLY use tokens from tokens.css (--wld-* variables). Never hardcode colors not in tokens.css.
2. **Components**: ALWAYS reference the HTML patterns in design-system/sections/*.html. Never invent new patterns.
3. **Spacing & Radius**: Use only the scale defined in tokens.css.
4. **Alerts**: MUST use slide-in-from-top animation: translate-y-(-2) opacity-0 → translate-y-0 opacity-100, duration-300 ease-in-out. See design-system/sections/feedback.html for the exact pattern.
5. **Dialogs/Modals**: MUST use: backdrop bg-black/50 fade-in (opacity-0 → opacity-100 duration-200), modal scale-in (scale-95 opacity-0 → scale-100 opacity-100 duration-200 ease-out). See design-system/sections/feedback.html.
6. **New components**: Any new UI component MUST have a corresponding entry added to the relevant section file.
7. **Deviations**: NEVER deviate from the design system. If a needed pattern doesn't exist, add it to the design system first, then use it.
8. **Tailwind**: Use Tailwind utility classes. Use arbitrary values (e.g. bg-[#1a1a1a]) only to match exact design tokens.

## File References
- Color tokens: /design-system/tokens.css
- Component patterns: /design-system/sections/<section>.html
- Component index: /design-system/COMPONENTS.md
- Master showcase: /design-system/index.html
