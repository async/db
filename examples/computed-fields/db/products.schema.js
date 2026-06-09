import { collection, field } from '@async/db/schema';

export default collection({
  description: 'Products that store cents and expose formatted display values.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable product id.',
    }),
    name: field.string({
      required: true,
      description: 'Product name.',
    }),
    priceCents: field.number({
      required: true,
      description: 'Stored integer price in cents.',
    }),
    priceLabel: field.computed(field.string({
      description: 'Formatted price for UI display.',
    }), ({ record }) => formatMoney(record.priceCents)),
  },
  seed: [
    {
      id: 'prod_sticker',
      name: 'Async DB Sticker',
      priceCents: 500,
    },
    {
      id: 'prod_mug',
      name: 'Local Data Mug',
      priceCents: 2000,
    },
  ],
});

function formatMoney(cents) {
  return `$${(Number(cents ?? 0) / 100).toFixed(2)}`;
}
