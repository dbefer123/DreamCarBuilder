import { sanAngelo } from './sanAngelo.js';
import { saltFlats, crashSite, desert, highlands } from './others.js';
import { defaultMap } from './default.js';

export { MAP_LIST } from './list.js';

export const MAPS = {
  default: defaultMap,
  sanangelo: sanAngelo,
  saltflats: saltFlats,
  crashsite: crashSite,
  desert,
  highlands,
};

export const DEFAULT_MAP = 'default';
// Single player is played on this map only
export const CAREER_MAP = 'default';
