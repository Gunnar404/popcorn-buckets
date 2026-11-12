// Shape of one found bucket, used by update.mjs (Claude API extraction) and
// check-findings.mjs (validating findings/latest.json from the scheduled session).
import { z } from "zod";
import { KNOWN_CHAINS } from "./lib.mjs";

export const BucketSchema = z.object({
  existingId: z
    .string()
    .nullable()
    .describe("id of the matching item from the KNOWN list, or null if this is new"),
  movie: z.string().describe("Movie title"),
  name: z
    .string()
    .describe("Short name of the collectible, e.g. 'Sandworm popcorn bucket' or 'Book tin'"),
  design: z
    .string()
    .nullable()
    .describe(
      "2-4 word canonical name of the physical design, written identically when the same bucket is sold at several chains (e.g. 'fish bowl', 'doctor doom statue', 'sandworm')",
    ),
  chain: z.string().describe(`Theater chain. One of: ${KNOWN_CHAINS.join(", ")}`),
  availableDate: z
    .string()
    .nullable()
    .describe("First day it can be bought in theaters, YYYY-MM-DD, or null if unannounced"),
  dateNote: z
    .string()
    .nullable()
    .describe("Caveats about the date, e.g. 'with Thursday previews', 'estimated', 'coming soon'"),
  movieReleaseDate: z.string().nullable().describe("Movie's US release date, YYYY-MM-DD"),
  price: z.string().nullable().describe("Price as stated, e.g. '$34.99 with large popcorn'"),
  purchaseNotes: z
    .string()
    .nullable()
    .describe("How to get it: in theater only, online/app pre-order, while supplies last, limit, etc."),
  description: z.string().nullable().describe("One or two sentences describing the design"),
  imageUrl: z
    .string()
    .nullable()
    .describe("Direct URL of a photo of this specific item (.jpg/.png/.webp), if one was found"),
  sources: z.array(z.string()).describe("URLs of pages that describe this item"),
});

export const ResultSchema = z.object({ buckets: z.array(BucketSchema) });
