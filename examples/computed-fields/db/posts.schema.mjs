import { collection, field } from '@async/db/schema';

export default collection({
  description: 'Posts with derived reading metadata.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable post id.',
    }),
    title: field.string({
      required: true,
      description: 'Post title.',
    }),
    authorId: field.string({
      required: true,
      description: 'Author user id.',
      relation: {
        name: 'author',
        to: 'users',
        toField: 'id',
        cardinality: 'one',
      },
    }),
    body: field.string({
      required: true,
      description: 'Stored markdown body.',
    }),
    readingTimeMinutes: field.computed(field.number({
      description: 'One-minute minimum reading estimate derived from the body.',
    }), {
      resolveMany({ records }) {
        return new Map(records.map((record) => [
          record.id,
          readingTimeMinutes(record.body),
        ]));
      },
    }),
  },
  seed: [
    {
      id: 'post_intro',
      title: 'Computed fields are projections',
      authorId: 'u_1',
      body: 'Computed fields keep stored fixture data small while adding useful values when a client selects them.',
    },
    {
      id: 'post_release',
      title: 'Batch resolver example',
      authorId: 'u_2',
      body: 'resolveMany can derive values for an entire selected page at once.',
    },
  ],
});

function readingTimeMinutes(body) {
  const wordCount = String(body ?? '').trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}
