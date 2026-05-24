import { collection, field } from '@async/db/schema';

export default collection({
  description: 'Orders that derive totals from nested items and related products.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable order id.',
    }),
    customerName: field.string({
      required: true,
      description: 'Stored customer display name.',
    }),
    items: field.array(field.object({
      productId: field.string({ required: true }),
      quantity: field.number({ required: true }),
    }), {
      description: 'Stored line items.',
    }),
    itemCount: field.computed(field.number({
      description: 'Total quantity across line items.',
    }), ({ record }) => itemCount(record)),
    totalCents: field.computed(field.number({
      description: 'Order total calculated from current product prices.',
    }), async function orders_totalCents_resolver({ record }) {
      return orderTotalCents(this.get('db'), record);
    }),
    receiptLine: field.computed(field.string({
      description: 'Human-readable receipt summary.',
    }), async function orders_receiptLine_resolver({ record }) {
      const total = await orderTotalCents(this.get('db'), record);
      return `${record.customerName} - ${itemCount(record)} items - ${formatMoney(total)}`;
    }),
  },
  seed: [
    {
      id: 'ord_1',
      customerName: 'Ada Lovelace',
      items: [
        { productId: 'prod_sticker', quantity: 3 },
        { productId: 'prod_mug', quantity: 2 },
      ],
    },
  ],
});

function itemCount(order) {
  return (order.items ?? []).reduce((total, item) => total + Number(item.quantity ?? 0), 0);
}

async function orderTotalCents(db, order) {
  const products = await db.collection('products').all();
  const prices = new Map(products.map((product) => [product.id, product.priceCents]));
  return (order.items ?? []).reduce((total, item) => (
    total + Number(prices.get(item.productId) ?? 0) * Number(item.quantity ?? 0)
  ), 0);
}

function formatMoney(cents) {
  return `$${(Number(cents ?? 0) / 100).toFixed(2)}`;
}
