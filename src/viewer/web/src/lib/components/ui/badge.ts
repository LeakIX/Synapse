import { tv, type VariantProps } from 'tailwind-variants';

/**
 * The badge style map. A badge states one short fact, such as a queue state
 * or an issue type.
 *
 * tone: neutral | info | success | danger | warning. Default neutral.
 */
export const badgeVariants = tv({
  base:
    'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ' +
    'whitespace-nowrap',
  variants: {
    tone: {
      neutral: 'bg-border text-text',
      info: 'bg-node-epic text-on-primary',
      success: 'bg-success text-text',
      danger: 'bg-danger text-text',
      warning: 'bg-warning text-on-primary',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});

export type BadgeTone = VariantProps<typeof badgeVariants>['tone'];
