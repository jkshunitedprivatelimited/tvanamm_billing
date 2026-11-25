import { z } from 'zod';
import { chefDraftSchema } from './chef-sop-schema';

export const chefStockDraftSchema = z.object({
  source: z.literal('chef_workbook'),
  collectionId: z.uuid(),
  itemId: z.uuid(),
  revision: z.int().positive(),
  draft: chefDraftSchema,
});
