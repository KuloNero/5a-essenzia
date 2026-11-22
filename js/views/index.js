import { dashboard } from './dashboard.js';
import { warehouse, receive, lotView, scan } from './warehouse.js';
import { materials, materialEdit, suppliers } from './materials.js';
import { recipes, recipeEdit } from './recipes.js';
import { batches, batchNew, batchView } from './production.js';
import { customers, orders, orderNew, orderView, pricing } from './sales.js';
import { trace } from './trace.js';
import { labels } from './labels.js';
import { dataView } from './data.js';
import { settings } from './settings.js';

export const routes = [
  [/^\/$/, dashboard],
  [/^\/scan$/, scan],
  [/^\/warehouse$/, warehouse],
  [/^\/receive$/, receive],
  [/^\/lot\/([\w-]+)$/, lotView],
  [/^\/materials$/, materials],
  [/^\/material\/([\w-]+)$/, materialEdit],
  [/^\/suppliers$/, suppliers],
  [/^\/recipes$/, recipes],
  [/^\/recipe\/([\w-]+)$/, recipeEdit],
  [/^\/batches$/, batches],
  [/^\/batch-new$/, batchNew],
  [/^\/batch\/([\w-]+)$/, batchView],
  [/^\/customers$/, customers],
  [/^\/orders$/, orders],
  [/^\/order-new$/, orderNew],
  [/^\/order\/([\w-]+)$/, orderView],
  [/^\/pricing$/, pricing],
  [/^\/trace$/, trace],
  [/^\/labels$/, labels],
  [/^\/data$/, dataView],
  [/^\/settings$/, settings],
];
