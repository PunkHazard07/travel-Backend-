export const escapeRegExp = (value) => {
  const str = value == null ? '' : String(value);
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};
