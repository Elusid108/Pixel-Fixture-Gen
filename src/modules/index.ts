import type { FixtureDef } from '../types';
import { strutNode } from './strut-node/build';

/** Workbench system builds. They take a `design` json param and live on the bench, not in the catalogue. */
export const MODULES: FixtureDef[] = [strutNode];
