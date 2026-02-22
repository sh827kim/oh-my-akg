/**
 * Spinner 컴포넌트 (커스텀)
 * 로딩 인디케이터
 */
import * as React from 'react';
import { cn } from '../lib/utils';

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-4',
};

const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size = 'md', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'animate-spin rounded-full border-muted border-t-primary',
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Spinner.displayName = 'Spinner';

export { Spinner };
