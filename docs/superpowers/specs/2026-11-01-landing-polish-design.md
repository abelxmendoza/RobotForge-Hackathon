# Landing Page Polish Design

## Intent

Preserve the currently deployed RobotForge landing page and remove the dense
“one-click demo, mid-run” screenshot that weakens the final call to action.

## Selected approach

Use a restrained cleanup rather than a redesign. Keep the current hero, colors,
typography, sections, proof, trailer, cards, navigation, final CTA copy, and both
CTA buttons. Remove only the `demo-shot.jpg` figure and its caption from the
final CTA band, then adjust that band’s spacing so it finishes cleanly without
an empty image-sized gap.

The rejected approaches are a product-first redesign and a proof-first redesign;
both change the deployed page more dramatically than requested.

## Constraints

- Do not change the rest of the landing-page hierarchy or visual language.
- Do not replace the screenshot with generated artwork or another large image.
- Do not delete the demo asset yet; other code or documentation may still refer
  to it. Remove the asset only in a later cleanup after repository-wide proof
  that it has no consumers.
- Keep desktop, mobile, reduced-motion, and static-export behavior intact.

## Verification

- The final CTA still renders its heading, explanation, Run the demo, and Open
  the app controls.
- The landing source no longer renders `demo-shot.jpg` or its caption.
- Existing landing source checks and the production Next build pass.
