# Component Reference

A complete reference of all components and documentation in the resist.net design system.

---

## Components

### AlertDialog

A bottom-sheet modal dialog built on Vaul and Radix UI Dialog. It interrupts the user with important content that requires a response — confirmations, destructive actions, or legal agreements. It slides up from the bottom of the screen over a semi-transparent overlay. Use it when an action is irreversible or requires explicit user acknowledgment before proceeding.

**Variants:**
- Closed (Trigger Button)
- Default (Open)
- With Icon (Open)
- With Long Content (Open)

---

### BottomBar

A container for action buttons fixed at the bottom of a view. Provides a consistent layout for primary and secondary actions, supporting both horizontal (side-by-side) and vertical (stacked) arrangements. The grid-based horizontal layout auto-collapses to a single column when only one button is present. Used to anchor the main call-to-action(s) to the bottom of a screen in mini-app flows — e.g., confirm/cancel pairs on transaction confirmations, single CTAs on onboarding steps.

**Variants:**
- Horizontal
- Vertical
- Single Button
- Horizontal Disabled
- Horizontal — Primary Disabled

---

### BulletList

A vertically stacked list component where each item pairs a circular icon badge with text content. The default bullet is a spark/star icon on a dark (#181818) circular background. Supports custom icons, custom bullet colors, and arbitrary ReactNode children. Use it to present feature highlights, permission lists, onboarding steps, or any enumerated content that benefits from a visual marker — especially in mini-app contexts where plain bullet points lack visual weight.

**Variants:**
- Default
- With Custom Items
- With Long Text
- With Custom Bullet

---

### Button

A pill-shaped, full-rounded interactive button used for primary actions, secondary choices, and icon-only triggers in World Mini Apps. Supports three semantic variants (primary, secondary, tertiary), two text sizes (lg/sm), an icon-only square size, optional full-width layout, and disabled states. Haptic feedback fires on tap. Use primary for the single most important action per screen, secondary for complementary actions, and tertiary for low-emphasis controls.

**Variants:**
- Primary Large
- Primary Small
- Secondary Large
- Tertiary Large
- Text With Icon (Primary Large)
- Icon Only
- Full Width Primary

---

### Checkbox

A checkbox component that allows users to select one or multiple options. Built on top of Radix UI's Checkbox primitive for accessibility and customization. Use it for binary on/off selections in forms, settings, and filter panels where users need to pick one or more items from a list.

**Variants:**
- Checked
- Unchecked
- Disabled Checked
- Disabled Unchecked
- With Label
- Interactive Toggle

---

### Chip

A compact pill-shaped label component that displays text with optional status icons. Used to indicate category, status, or semantic state (success, warning, error, info) inline within content. Height is fixed at 28px (h-7), fully rounded, with medium-weight text at 13px. Icons appear on the left at 16x16px.

**Variants:**
- Default
- Default With Icon
- Success With Icon
- Warning With Icon
- Error With Icon
- Important With Icon
- Custom Colors

---

### CircularIcon

A circular container that displays an icon centered within a full-circle (border-radius: 9999px) background. Used to visually represent actions, statuses, or categories with a consistent circular badge format. Props: children (icon type: Star | Shield | Spark | None), size (xs | sm | md | lg | xl, default md), className (background color class, default bg-gray-200). The icon scales proportionally with the container size. Commonly used in lists, cards, transaction rows, and feature highlights to give icons a branded circular backdrop.

**Variants:**
- Default (md, Spark icon)
- Size xs (24px)
- Size sm (44px)
- Size lg (64px)
- Size xl (88px)
- Star icon
- Shield icon
- Empty (no icon)
- Success state
- Error state
- Warning state
- Info state
- World Blue (brand)
- All sizes comparison

---

### CircularState

A circular status indicator used to communicate the outcome or current state of an operation or entity. It displays a full-bleed colored circle with a semantic icon inside. Use it in transaction summaries, verification flows, or anywhere a user needs a clear at-a-glance status signal (success, error, warning, pending, or critical). Supports five sizes (xs–xl) and five semantic states, each mapped to a distinct background color and icon.

**Variants:**
- success
- error
- warning
- pending
- critical
- success-xs
- success-sm
- success-md
- success-lg
- success-xl

---

### ColorPicker

A color picker input component built as a radio group that lets users select from a predefined set of color swatches. Each swatch is a circular button displaying the color visually. When a swatch is selected, an inner ring indicator (transparent circle with white border) appears to show the active selection. Use this component in profile customization flows, theme selection, or any context where users pick from a discrete palette of colors.

**Variants:**
- Default (No Selection)
- Selected (First Color Active)
- Selected (Second Color Active)
- Disabled
- Disabled With Selection

---

### CountryDrawer

A responsive country selection component that adapts to screen size. On mobile it renders as a full-screen drawer (vaul-style, slides up from bottom), while on desktop it renders as a centered dialog modal. Typically paired with phone number input fields. Features a searchable, alphabetically-grouped list of countries with circular flag images and country names. Supports a customizable trigger element, disabled state, limited country lists, and RTL direction.

**Variants:**
- Trigger — Default (closed)
- Trigger — Disabled
- Trigger — Custom (With Custom Trigger)
- Dialog — Open (Desktop)
- Drawer — Open (Mobile full-screen)
- Trigger — RTL
- Dialog — Closed (animated out)

---

### Drawer

A full-screen or bottom-sheet drawer that slides up from the bottom of the screen, built on Vaul and Radix UI Dialog. Use it for contextual actions, forms, or scrollable lists that need to overlay the current view without navigating away. The default variant occupies the full viewport height; a "fit" height variant rounds the top corners and sizes to content.

**Variants:**
- Trigger (Closed State)
- Default (Full Page, Open)
- Full Page with Scrollable List
- With Inputs (Form Drawer)
- Bottom Sheet (Fit Height)
- Animated Open Transition

---

### Flag

A circular flag avatar that renders a country or region flag as an SVG image. It accepts an ISO 3166-1 alpha-2 country code and an optional size in pixels (default 40px). The flag is displayed as a circular crop (border-radius: 9999px) with object-cover fitting and a light gray background fallback. Use it in lists of countries, user profile locales, currency selectors, language pickers, or anywhere a compact national identity marker is needed.

**Variants:**
- Default (40px — DE)
- Small (24px — US)
- Medium (32px — GB)
- Large (56px — FR)
- Extra Large (80px — JP)
- Loading / Skeleton state
- Fallback / Unknown country code
- In a Country Selector row
- In a Currency / Locale badge
- Multiple flags — Size comparison grid

---

### Form

A form field component that wraps an input with a label and validation/helper message. Used to collect user input with built-in validation state feedback — neutral helper text, error messages, and disabled states. Built on Radix UI primitives with smooth focus transitions and accessible labeling.

**Variants:**
- With Validation Message
- With Error State
- Disabled
- Focused
- Multi-field Form

---

### Haptic

A transparent wrapper component that provides haptic feedback when touched. It has no visual styling of its own — it wraps any children and triggers device vibration/haptic responses on interaction. Use it when you need to add haptic feedback to custom components not already covered by the UI Kit's built-in interactive elements. Supports three variants: impact (collision-style feedback in light/medium/heavy/soft/rigid intensities), notification (outcome-style feedback for success/warning/error states), and selection (for selection-change events like checkboxes or toggles).

**Variants:**
- Selection (Default)
- Impact — Light
- Impact — Medium
- Impact — Heavy
- Notification — Success
- Notification — Warning
- Notification — Error
- All Variants Overview

---

### Input

A text input field used to collect user-typed data. It supports a default text state, a floating label (animated label that moves above the input on focus/fill), a disabled state, and variants with leading or trailing icons/decorators. Used whenever the app needs to capture freeform text, numbers, email addresses, or phone numbers. The container transitions from a filled gray background with matching border to a white background with gray border on focus, providing clear visual feedback.

**Variants:**
- Text (Default)
- Floating Label
- Disabled
- With Leading Icon
- With Trailing Icon
- Focused (Active)

---

### ListItem

A versatile list item component for displaying content in list format with consistent height and alignment. Renders as a clickable button with a fixed height of 4.75rem (76px), rounded corners, and a light gray background. Supports optional start adornments (icons, avatars, tokens) on the left and end adornments (chips, actions, badges) on the right. A label and description are stacked vertically in the content area with text truncation. Can be disabled to prevent interaction. Variants include: duotone (alternating backgrounds), outline (bordered), and ghost (minimal styling).

**Variants:**
- Basic
- With Start Adornment
- With End Adornment
- Disabled
- With Both Adornments
- Ghost (Minimal)

---

### LiveFeedback

A wrapper component that overlays animated state feedback (pending spinner, success checkmark, failed X) on top of any submit button or bottom-bar action area. It keeps the button's layout space intact (using visibility:hidden on the button content) while showing a centered overlay that communicates the current async operation state. Use it around primary action buttons on forms, transaction confirmations, or any flow where user-initiated async work needs clear inline feedback without a separate toast or modal.

**Variants:**
- Default
- Pending
- Success
- Failed
- Icon Only
- Icon Only – Pending
- With Bottom Bar
- With Bottom Bar – Pending
- Disabled

---

### Marble

A circular image component styled to resemble a marble. It displays an avatar or decorative image clipped to a circle with a subtle 2px light-gray border and 3px inner padding that creates a clean ring effect. Used for user profile pictures, token/coin avatars, and decorative circular media in World Mini Apps. Supports any image source including PNG photos and inline SVG generative art.

**Variants:**
- Default
- Multiple Marbles
- Different Sizes
- Default (120px) — size reference
- Generative SVG Marble

---

### NumberPad

A numeric keypad component that allows users to input numbers and decimals. It renders a 3-column, 4-row grid of keys (1-9, decimal point, 0, and a delete/backspace key). Each key has a circular hover/active indicator that transitions on interaction. Used for amount entry flows in payment and wallet contexts. Supports controlled mode with a live value display, disabled state, and long-press-to-clear on the delete key.

**Variants:**
- Default
- Controlled (with value display)
- Disabled
- Clear on Long Delete Press

---

### OTPField

A one-time password input field composed of individual digit slots (default 6) laid out in a horizontal row. Used for entering numeric verification codes, PINs, or short auth codes. Supports controlled/uncontrolled usage, custom maxLength (slot count), error state with inline message, and three character modes: digits, chars, or digitsAndChars. The underlying input is a single hidden text field; the visible slots are styled divs that mirror focus and fill state.

**Variants:**
- Default (Empty)
- Active / Focused (First Slot)
- Partially Filled
- Fully Filled (Complete)
- Error State
- Disabled

---

### PasswordField

A secure password input field for World Mini Apps. It provides a text input masked as password dots with a visibility toggle button (eye icon) on the right. Use it for login, signup, and any authentication flows requiring a password entry. The field transitions smoothly between its resting, focused, error, and disabled states, and toggles between password-hidden and password-visible modes.

**Variants:**
- Default
- Focused
- Filled (Password Hidden)
- Filled (Password Visible)
- Error
- Error Focused
- Disabled
- Full Interactive

---

### PhoneField

A phone number input field with an integrated country selector. The component combines a flag icon, dial code prefix, a divider, and a tel-type input into a single pill-shaped container. Tapping the country selector opens a full-screen bottom drawer with an alphabetized list of countries and a search field. Use PhoneField for any form that collects international phone numbers — authentication flows, onboarding, payment, or profile pages. It supports default, focused, filled/valid, error, disabled, and RTL states.

**Variants:**
- Default
- Focused
- Filled (Valid)
- Error
- Disabled
- Custom Default Country
- Country Selector Drawer (Open)
- RTL

---

### Pill

A pill-shaped toggle/label button with a fully rounded appearance. Use it as a compact, tappable chip-style selector — for filter tags, category toggles, or selectable label chips. Has two states: unchecked (transparent background) and checked (light gray background). Built on a native button element with Radix UI Slot support for polymorphic rendering.

**Variants:**
- Default (Unchecked)
- Checked
- Interactive Group
- As Link (asChild pattern)

---

### Progress

A horizontal progress bar that communicates the completion status of a task or process. The bar fills left-to-right based on a value between 0 and 100. The track background is customized with Tailwind bg-* classes and the indicator color with text-* classes (the indicator uses bg-current, inheriting the parent color). Use it for onboarding flows, file uploads, multi-step forms, or any operation where showing incremental progress improves perceived performance.

**Variants:**
- Default (33%)
- 0% (Empty / Start)
- 75% (Near Complete)
- 100% (Complete)
- Error State (custom color)
- Warning State (custom color)
- With Label (accessible)
- Dark background

---

### RadioGroup

A radio group component built on Radix UI's RadioGroup primitive that lets users select exactly one option from a list. Use it for mutually exclusive choices (e.g. payment method, delivery option, preference setting). Each item renders as a 24px circular button that transitions between an empty ring (unchecked, gray-200 border) and a filled dark circle with a white tick checkmark (checked, gray-900 fill). Items can be labeled or bare, individual items can be disabled while the rest stay interactive, and the full group supports controlled/uncontrolled usage.

**Variants:**
- Default
- With Labels
- Disabled Items
- Controlled
- Single Item

---

### SearchField

A text input component designed for search functionality. Use it to allow users to search for names, addresses, or ENS identifiers. It features a pill-shaped container with a leading search icon, smooth focus transitions that change background and border color, and support for error states with inline error messages and a paste-from-clipboard action button variant.

**Variants:**
- Default
- Disabled
- Error
- With Paste Button

---

### Select

A dropdown select component built on Radix UI Select primitive. Provides a styled trigger button that opens a floating listbox with options. Supports placeholder text, pre-selected values, disabled state, error state with validation message, and controlled/uncontrolled open state. Use it for any single-option selection from a predefined list — currency amounts, categories, settings values. The component follows the World Mini Apps design language: rounded pill-adjacent corners (0.625rem), gray-100 surface, gray-300 border on focus/open, white background when open, and TWK Lausanne / sans-serif font stack.

**Variants:**
- Default (closed, placeholder)
- With Selected Value
- Open (dropdown visible)
- Disabled
- Error State
- Error State with Selected Value
- Controlled Open with Toggle

---

### Skeleton

A loading placeholder that mimics the shape and layout of content before it has loaded. It uses a subtle shimmer animation (moving gradient sweep) to indicate loading state. Use Skeleton when fetching data to preserve visual layout structure and reduce perceived wait time. The component supports rectangular, rounded, and circular shapes — making it versatile for representing text lines, avatars, images, buttons, and complex card layouts.

**Variants:**
- Default
- Avatar
- Text Line
- Paragraph
- List Item
- Card
- Button
- Complex Layout

---

### Skeleton Typography

A skeleton loading state for text content that matches the styling of Typography components. Use during data fetching to show placeholder lines that mirror the exact line-height and spacing of each Typography variant (Text/body, Display, Heading, Subtitle, Label, Number). Each skeleton bar is sized to match the actual rendered height of the corresponding text variant, preserving layout stability while content loads.

**Variants:**
- Text
- Display
- Heading
- Subtitle
- Label
- Number
- Multi-line Mixed

---

### Switch

A toggle switch component that provides a visual way to turn an option on or off. Use it to represent boolean settings or preferences that take effect immediately — replacing a checkbox where the on/off metaphor is clearer to the user.

**Variants:**
- Unchecked
- Checked
- Disabled Unchecked
- Disabled Checked
- With Label
- Interactive Demo

---

### Tabs

A bottom navigation tab bar component used in World Mini Apps to switch between top-level views. It renders as a horizontal grid of icon+label tab items, where each tab is a radio-button-style toggle. Use it for primary navigation at the bottom of a mobile screen. Supports 2–4 tabs, active/inactive states, optional dual icons (outline for inactive, filled for active), and link-wrapping for page navigation.

**Variants:**
- Default
- Active Icons
- With Links
- Disabled

---

### TextArea

A multi-line text input component for collecting longer-form user input. Use it for messages, descriptions, feedback forms, or any content requiring more than a single line. Supports placeholder text, floating labels, error states, disabled states, and resizable height. Transitions smoothly between idle and focused appearances using 300ms cubic-bezier easing.

**Variants:**
- Default
- Focused
- With Value
- Error
- Disabled
- Floating Label

---

### Toast

The Toast component provides temporary, auto-dismissing notifications that slide in from the top of the screen. Built on Radix UI Toast primitives, it renders as a compact pill-shaped banner fixed at the top of the viewport. Use it for brief feedback after user actions — success confirmations (payment sent, profile saved) and error alerts (transaction failed, network error). It supports two semantic variants (success and error), includes haptic feedback on mobile, and auto-dismisses after a configurable duration (default 3000ms). The component pairs a circular icon badge with short message text inside a white pill with a subtle border.

**Variants:**
- Success Toast (Open)
- Error Toast (Open)
- Toast Closed (Exit Animation)
- Interactive Toast Demo
- Toaster Container (Empty State)

---

### ToggleGroup

A toggle group component that allows users to select one or multiple options from a set of circular pill buttons. Each item is a 32px round button that shows selected state via background fill. Use it for time-range selectors, filter tabs, or any mutually-exclusive or multi-select option set where compact horizontal presentation is needed.

**Variants:**
- Default (Single Select)
- Multiple (Multi-Select)
- Disabled Item

---

### Token

A circular SVG icon component that displays a cryptocurrency token symbol. Used wherever a recognizable token identity is needed — transaction lists, asset pickers, wallet balances, and send/receive flows. Accepts a token symbol value (BTC, ETH, USDC, WLD, DAI, USDT, SUI, DOGE, XRP, SOL, LINK), a size in pixels (default 40), a variant (color or monochrome), and a disabled boolean. The color variant renders the token's brand color as the circle background with a white symbol. The monochrome variant uses a neutral light-gray background with a dark symbol for use on colored surfaces or when brand colors should be suppressed. The disabled variant desaturates to a medium gray circle with a white symbol and conveys an unselectable or inactive state.

**Variants:**
- Default (Color)
- Monochrome
- Disabled
- Size Small (24px)
- Size Large (64px)
- Multi-token Display

---

### TopBar

A navigation bar component used at the top of pages or modals to display a title with optional start and end icon button adornments. The bar sits on a black background with a white rounded-top card, creating a bottom-sheet-style appearance. Height is fixed at 72px with 24px top-left/top-right border radius. Use it as a page header inside the World mini app shell — the black surround represents the OS chrome above the modal sheet.

**Variants:**
- Default
- With Start Adornment
- Only Start Adornment
- With End Adornment
- With Both Adornments

---

### Typography

The Typography system uses the TWK Lausanne font (substitute with system-ui or Inter when the font is unavailable) and provides a five-tier hierarchy — Display, Headings (H1–H4), Subtitles (S1–S4), Labels (L1–L2), and Body (B1–B4). Use Display for hero splash text, Headings for page/section titles, Subtitles for card titles and secondary headings, Labels for UI control text and badges, and Body for prose content. Each tier controls font-size, font-weight, line-height, and letter-spacing consistently so that visual hierarchy is preserved regardless of context.

**Variants:**
- Display 1
- Heading 1
- Heading 2
- Heading 3
- Heading 4
- Subtitle 1
- Subtitle 2
- Subtitle 3
- Subtitle 4
- Label 1
- Label 2
- Body 1
- Body 2
- Body 3
- Body 4
- Full Scale Reference

---

### VerificationBadge

A badge component that displays World ID orb verification status. Use it to indicate whether a person is a verified human (orb verified) with a blue badge, or unverified with a gray badge. The badge renders as a circular SVG icon featuring a human silhouette. It accepts a `verified` boolean prop and an optional `className` for custom sizing. Typical use cases: next to a username, inside a profile header, or on a transaction list item to signal trust level.

**Variants:**
- Verified
- Unverified
- With Custom Size

---

### WalletAddressField

A text input component designed for entering and validating blockchain wallet addresses. Used in payment flows, recipient selection, and address book forms. Features a "Paste" button with clipboard icon for quick address entry, and supports validation states (error, success) with appropriate visual feedback. The field has a 56px fixed height with 10px border radius, smooth focus transitions, and inline status icons on the right side.

**Variants:**
- Default
- With Value
- With Error
- With Success
- Disabled
- Custom Placeholder
- Focused
- All States Showcase

---

## Documentation

### Colors

The World Mini Apps color system provides a comprehensive set of semantic and brand color tokens organized into three categories: Primary Colors (Gray scale plus semantic palettes for Success, Error, Warning, and Info), Specialty Colors (World Blue, Carrot Orange, Purple, Green, Blue — each with a primary and a lighter secondary tint), and Token Colors (Worldcoin, Digital Dollars, Bitcoin, Ethereum — brand-specific primary/secondary pairs for crypto assets). Use these tokens to ensure consistent visual communication across status states, brand expressions, and asset representations throughout mini app UIs.

**Variants:**
- Gray Scale
- Success Palette
- Error Palette
- Warning Palette
- Info Palette
- Specialty Colors
- Token Colors

---

### Haptics

Haptics is a behavioral API (not a visual component) for triggering device tactile feedback in World Mini Apps. All interactive UI Kit components include haptic feedback by default. Use this API for custom implementations. Three categories: Impact (physical collision feel — light/medium/heavy/soft/rigid), Notification (outcome signals — success/warning/error), and Selection (state-change acknowledgment). Haptics improve responsiveness, accessibility for visual impairments, and user engagement.

**Variants:**
- Impact — Light
- Impact — Medium
- Impact — Heavy
- Impact — Soft
- Impact — Rigid
- Notification — Success
- Notification — Warning
- Notification — Error
- Selection Changed
- Reference Card — All Types

---

### Icons

The Icons component is a comprehensive library of 140+ SVG-based React icon components available in three visual variants: outline (customizable stroke width), regular (fixed stroke width for consistent scaling), and solid (filled, no stroke for bold emphasis). Icons render at 1.5em by default, accept standard SVG props for size/color customization, and use currentColor so they inherit text color from their container. Use outline icons for lightweight UI, regular for consistent scaled interfaces, and solid for high-contrast emphasis states.

**Variants:**
- Icon Grid — Outline Variant
- Icon Grid — Regular Variant
- Icon Grid — Solid Variant
- Icon Cell — Default State
- Icon Cell — Hover State
- Icon Search — Searchable Grid
- Icon Usage — Sizing
- Icon Usage — Stroke Width Variants (Outline only)

---

### Internationalization

The Internationalization (i18n) documentation guide explains how to localize country names and sorting across components like PhoneField and CountryDrawer. It covers locale registration for SSR and client-side apps, dynamic locale loading via loadLocale, BCP 47 locale prop usage, TypeScript types, and the full list of supported locales. Use this guide when building apps that need multi-language country selectors or right-to-left layout support.

**Variants:**
- Page Header
- SSR Locale Registration
- Client-Side Locale Registration
- PhoneField with Locale
- CountryDrawer with RTL Locale
- Dynamic Locale Loading
- TypeScript Types
- Notes Callout
- What Gets Localized

---

### Spacing

The World Mini Apps UI Kit uses a 4px base grid system as its foundational measurement unit. All spacing, sizing, padding, and margin values are multiples of 4px. This system simplifies alignment across all components, makes designs easier to adapt to different screen sizes and resolutions, and encourages uniformity that results in a structured, clean, and balanced appearance. The documentation defines specific spacing rules for key layout areas: main content padding (24px), section gaps (40px), subheadline-to-content gaps (16px), header-to-search-bar gaps (16px), button-to-iOS-bottom-bar (32px), button-above-keyboard (24px), bottom-menu-to-iOS-bar (20px), top-of-menu minimum padding (8px), and main-title top safe area (64px).

**Variants:**
- 4px Layout System
- Main Paddings
- Sections
- Search Bar
- Button Spacing
- Button With Active Keyboard
- Bottom Menu States
- Main Title Spacing
