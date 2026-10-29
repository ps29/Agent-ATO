# Updated design

The web app ships two looks. **Original** is the default and is unchanged. **Updated** is opt-in from the
Original / Updated switch in the header, and the choice is saved with the other display settings.

## How it works

- `settings.ts` stores `design` (`original` or `updated`) and sets `data-design` on `<html>`.
- `redesign.css` holds every Updated rule, all scoped to `[data-design='updated']`, so Original renders as before.
- `mascot.css` and `components/Mascot.tsx` add the header mascot, which only renders in Updated.
- Updated uses its own dark palette and ignores the colour theme picker. Fonts and text size still apply.

## Look

Translucent glass panels over a sunrise sky, pill controls with a springy press, and softer rows. Colour is kept for
meaning (risk, errors); motion is turned off by the reduce-motion setting or the system preference.

## Mascot

Eyes follow the pointer, antennae sway, and it perks up on hover. Pointer position is written to CSS variables, so
moving the mouse does not re-render React.
