import type { FixtureDef } from '../types';

/** A catalogue concept not built yet, shown as "drawing board" so the roadmap stays visible. */
export interface PlannedFixture {
  code: string;
  name: string;
  family: FixtureDef['family'];
  tagline: string;
  schedule: string;
}
