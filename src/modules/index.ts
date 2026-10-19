import type { FixtureDef } from '../types';
import { columnStack } from './column-stack/build';
import { facetWall } from './facet-wall/build';
import { hiveWall } from './hive-wall/build';
import { linea } from './linea/build';
import { miniRig } from './mini-rig/build';
import { pixelChain } from './pixel-chain/build';
import { strutNode } from './strut-node/build';

/** Workbench system builds. They take a `design` json param and live on the bench, not in the catalogue. */
export const MODULES: FixtureDef[] = [strutNode, hiveWall, linea, miniRig, facetWall, columnStack, pixelChain];
