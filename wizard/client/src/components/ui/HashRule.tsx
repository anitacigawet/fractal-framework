interface HashRuleProps {
  className?: string;
}

/**
 * Dashed amber horizontal rule — section divider.
 */
export function HashRule({ className = "" }: HashRuleProps) {
  return <div className={`hash-rule ${className}`.trim()} />;
}
