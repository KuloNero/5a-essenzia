// Allergeni da profumo soggetti a dichiarazione in etichetta (Reg. CE 1223/2009, All. III).
// "base" = i 26 storici (esclusi quelli poi vietati); "2023" = selezione dei nuovi introdotti
// dal Reg. (UE) 2023/1545 (obbligatori per i prodotti immessi sul mercato dal 31/07/2026).
// L'elenco serve come suggerimento: è sempre possibile inserire nomi liberi.
// Verificare sempre con la versione consolidata vigente del Regolamento.

export const LEAVE_ON_THRESHOLD = 0.001; // % (10 ppm)
export const RINSE_OFF_THRESHOLD = 0.01; // % (100 ppm)

export const ALLERGENS = [
  // 26 storici
  ['Amyl Cinnamal', 'base'], ['Amylcinnamyl Alcohol', 'base'], ['Anise Alcohol', 'base'],
  ['Benzyl Alcohol', 'base'], ['Benzyl Benzoate', 'base'], ['Benzyl Cinnamate', 'base'],
  ['Benzyl Salicylate', 'base'], ['Cinnamal', 'base'], ['Cinnamyl Alcohol', 'base'],
  ['Citral', 'base'], ['Citronellol', 'base'], ['Coumarin', 'base'], ['Eugenol', 'base'],
  ['Evernia Furfuracea Extract', 'base'], ['Evernia Prunastri Extract', 'base'],
  ['Farnesol', 'base'], ['Geraniol', 'base'], ['Hexyl Cinnamal', 'base'],
  ['Hydroxycitronellal', 'base'], ['Isoeugenol', 'base'], ['Limonene', 'base'],
  ['Linalool', 'base'], ['Methyl 2-Octynoate', 'base'], ['Alpha-Isomethyl Ionone', 'base'],
  // Selezione Reg. (UE) 2023/1545
  ['Acetyl Cedrene', '2023'], ['Amyl Salicylate', '2023'], ['Anethole', '2023'],
  ['Benzaldehyde', '2023'], ['Camphor', '2023'], ['Carvone', '2023'],
  ['Beta-Caryophyllene', '2023'], ['Damascone', '2023'], ['Eucalyptol', '2023'],
  ['Eugenyl Acetate', '2023'], ['Geranyl Acetate', '2023'], ['Isoeugenyl Acetate', '2023'],
  ['Linalyl Acetate', '2023'], ['Menthol', '2023'], ['Methyl Salicylate', '2023'],
  ['Pinene', '2023'], ['Salicylaldehyde', '2023'], ['Santalol', '2023'],
  ['Sclareol', '2023'], ['Terpineol', '2023'], ['Terpinolene', '2023'], ['Vanillin', '2023'],
  ['Cananga Odorata Flower Oil', '2023'], ['Cinnamomum Cassia Leaf Oil', '2023'],
  ['Citrus Aurantium Amara Flower Oil', '2023'], ['Citrus Limon Peel Oil', '2023'],
  ['Eucalyptus Globulus Leaf Oil', '2023'], ['Eugenia Caryophyllus Leaf Oil', '2023'],
  ['Lavandula Angustifolia Oil', '2023'], ['Lavandula Hybrida Oil', '2023'],
  ['Mentha Piperita Oil', '2023'], ['Mentha Viridis Leaf Oil', '2023'],
  ['Myroxylon Pereirae Resin', '2023'], ['Pelargonium Graveolens Flower Oil', '2023'],
  ['Pogostemon Cablin Oil', '2023'], ['Rosa Damascena Flower Oil', '2023'],
  ['Santalum Album Oil', '2023'], ['Turpentine', '2023'],
].map(([name, list]) => ({ name, list }));
