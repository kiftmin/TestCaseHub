export interface Step {
  key: string;
  label: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  currentIndex: number;
  completedIndices?: number[];
  onStepClick?: (index: number) => void;
  className?: string;
}

export function Stepper({
  steps,
  currentIndex,
  completedIndices = [],
  onStepClick,
  className = "",
}: StepperProps) {
  return (
    <nav aria-label="Progress" className={`w-full ${className}`}>
      <ol className="flex items-start w-full">
        {steps.map((step, idx) => {
          const isCompleted = completedIndices.includes(idx) || idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isClickable = !!onStepClick && (isCompleted || isCurrent);

          const circleBase =
            "w-9 h-9 rounded-full flex items-center justify-center text-label-sm font-label-md border-2 transition-all shrink-0";
          const circleState = isCompleted
            ? "bg-secondary border-secondary text-on-secondary"
            : isCurrent
              ? "bg-secondary-container border-secondary text-on-secondary-container"
              : "bg-surface border-outline-variant text-on-surface-variant";

          const labelColor = isCurrent
            ? "text-on-surface"
            : isCompleted
              ? "text-on-surface"
              : "text-on-surface-variant";
          const descColor = isCurrent || isCompleted ? "text-on-surface-variant" : "text-on-surface-variant/60";

          return (
            <li
              key={step.key}
              className={`flex items-start flex-1 min-w-0 ${
                idx === steps.length - 1 ? "" : "after:content-[''] after:h-px after:flex-1 after:bg-outline-variant after:mx-md after:mt-[18px] after:min-w-[24px]"
              }`}
            >
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(idx)}
                className={`flex flex-col items-center text-left group ${
                  isClickable ? "cursor-pointer" : "cursor-default"
                }`}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className={`${circleBase} ${circleState}`}>
                  {isCompleted ? (
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  ) : (
                    idx + 1
                  )}
                </span>
                <span
                  className={`mt-2 text-label-sm font-label-sm ${labelColor} text-center whitespace-nowrap`}
                >
                  {step.label}
                </span>
                {step.description && (
                  <span className={`text-label-sm ${descColor} text-center mt-0.5 hidden md:block`}>
                    {step.description}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
