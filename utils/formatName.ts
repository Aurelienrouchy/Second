/**
 * Format a display name to show only the first letter of the last name.
 * "Jean Dupont" → "Jean D."
 * "Marie" → "Marie"
 * "Jean-Pierre De La Fontaine" → "Jean-Pierre D."
 */
export function formatDisplayName(name: string | undefined | null): string {
  if (!name) return 'Utilisateur';

  const trimmed = name.trim();
  const parts = trimmed.split(' ');

  if (parts.length <= 1) return trimmed;

  const firstName = parts[0];
  const lastNameInitial = parts[parts.length - 1].charAt(0).toUpperCase();

  return `${firstName} ${lastNameInitial}.`;
}
