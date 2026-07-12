export const SKILL_AREAS = [
  'Gastronomia', 'Direito', 'Contabilidade', 'TI', 'Marketing', 'Saúde', 'Educação', 'Construção', 'Culinária',
];

export const PROFICIENCY_LEVELS = [
  { value: 'beginner', labelKey: 'editProfile.levelBeginner' },
  { value: 'intermediate', labelKey: 'editProfile.levelIntermediate' },
  { value: 'advanced', labelKey: 'editProfile.levelAdvanced' },
  { value: 'specialist', labelKey: 'editProfile.levelSpecialist' },
];

export const LANGUAGE_OPTIONS = [
  'Português',
  'Inglês',
  'Espanhol',
  'Alemão',
  'Francês',
  'Italiano',
  'Japonês',
  'Mandarim',
  'Árabe',
  'Russo',
  'Holandês',
  'Sueco',
  'Norueguês',
  'Dinamarquês',
  'Polonês',
  'Turco',
  'Coreano',
  'Hindi',
];

/** Valor especial do select — abre campo para digitar o idioma. */
export const LANGUAGE_OTHER_VALUE = '__other__';

const LEGACY_LANGUAGE_MAP: Record<string, string> = {
  English: 'Inglês',
  Español: 'Espanhol',
  Deutsch: 'Alemão',
  Français: 'Francês',
  Italiano: 'Italiano',
  Portuguese: 'Português',
  Português: 'Português',
};

export function normalizeLanguageName(name: string): string {
  const trimmed = name.trim();
  return LEGACY_LANGUAGE_MAP[trimmed] || trimmed;
}

export const BR_STATES: Record<string, string[]> = {
  BA: ['Salvador', 'Feira de Santana', 'Ilhéus'],
  SP: ['São Paulo', 'Campinas', 'Santos'],
  RJ: ['Rio de Janeiro', 'Niterói'],
  MG: ['Belo Horizonte', 'Uberlândia'],
  RS: ['Porto Alegre', 'Caxias do Sul'],
  PE: ['Recife', 'Olinda'],
};

export const FOREIGN_REGIONS: Record<string, { states: string[]; cities: Record<string, string[]> }> = {
  DE: { states: ['Berlin', 'Bavaria', 'Hamburg'], cities: { Berlin: ['Berlin'], Bavaria: ['Munich'], Hamburg: ['Hamburg'] } },
  US: { states: ['New York', 'California', 'Florida'], cities: { 'New York': ['New York City'], California: ['Los Angeles', 'San Francisco'], Florida: ['Miami'] } },
  PT: { states: ['Lisboa', 'Porto'], cities: { Lisboa: ['Lisboa'], Porto: ['Porto'] } },
  UK: { states: ['England'], cities: { England: ['London', 'Manchester'] } },
  CA: { states: ['Ontario', 'Quebec'], cities: { Ontario: ['Toronto'], Quebec: ['Montreal'] } },
  BR: { states: Object.keys(BR_STATES), cities: BR_STATES },
};

export type SocialLinks = {
  instagram?: string;
  linkedin?: string;
  facebook?: string;
  website?: string;
  public_email?: string;
  whatsapp?: string;
};
