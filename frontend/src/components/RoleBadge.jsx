function RoleBadge({ role }) {
  return <span className={`badge badge--${role}`}>{role}</span>;
}

export default RoleBadge;
