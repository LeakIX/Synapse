import { tv, type VariantProps } from 'tailwind-variants';

/**
 * The button style map. A caller picks a variant and a size. A caller does
 * not repaint the button with a class.
 *
 * variant:
 * - primary: gold fill. It carries dark text, because gold with white text
 *   fails the contrast rule.
 * - secondary: bordered card surface. The default.
 * - ghost: text only, for a low weight action.
 * size: sm | md. Default md.
 * block: true adds full width.
 */
export const buttonVariants = tv({
  base:
    'inline-flex cursor-pointer items-center justify-center gap-1.5 ' +
    'rounded-md font-medium transition-colors focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50',
  variants: {
    variant: {
      primary: 'bg-primary text-on-primary hover:bg-primary-hover',
      secondary: 'border border-border bg-card text-text hover:border-primary',
      ghost: 'text-muted hover:text-text',
    },
    size: {
      sm: 'px-2 py-1 text-xs',
      md: 'px-3 py-1.5 text-sm',
    },
    block: {
      true: 'w-full',
    },
  },
  defaultVariants: {
    variant: 'secondary',
    size: 'md',
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
