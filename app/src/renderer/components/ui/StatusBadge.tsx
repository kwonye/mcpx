interface StatusBadgeProps {
  status: 'online' | 'offline' | 'error' | 'warning';
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const statusClass = `status-badge status-badge--${status}`;

  return (
    <div className={statusClass}>
      <span className="status-badge__dot" />
      {label && <span className="status-badge__label">{label}</span>}
    </div>
  );
}
