import {
	Entity,
	MikroORM,
	PrimaryKey,
	Property,
	ManyToMany,
	Collection,
} from '@mikro-orm/sqlite';

@Entity()
class Product {

  @PrimaryKey()
  id!: number;

  @Property()
  name: string;

	@ManyToMany('Category', 'products')
	categories = new Collection<Category>(this);
}

@Entity()
class Category {

  @PrimaryKey()
  id!: number;

  @Property()
  name: string;

	@ManyToMany('Product', 'categories', { owner: true })
	products = new Collection<Product>(this);
}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    dbName: ':memory:',
    entities: [Product, Category],
    debug: ['query', 'query-params'],
    allowGlobalContext: true, // only for testing
  });
  await orm.schema.refreshDatabase();
});

afterAll(async () => {
  await orm.close(true);
});

test('dataloader generated queries', async () => {
  {
    // All products except Product 4 are added into Category 1

    const p1 = orm.em.create(Product, { name: 'Product 1' });
    const p2 = orm.em.create(Product, { name: 'Product 2' });
    const p3 = orm.em.create(Product, { name: 'Product 3' });
    const p4 = orm.em.create(Product, { name: 'Product 4' });

    const c1 = orm.em.create(Category, { name: 'Category 1' });
    const c2 = orm.em.create(Category, { name: 'Category 2' });

    c1.products.add([p1, p2, p3]);
  }

  await orm.em.flush();
  orm.em.clear();

  // First see the result of initializing the product's categories without using dataloader
  {
    const p1 = await orm.em.findOneOrFail(Product, { name: 'Product 1' });

    console.log('WITHOUT DATALOADER:');
    await p1.categories.init({ dataloader: false });

    // This is the database query printed into the debug logs, we just print what it returned
    const rows = await orm.em.execute("select `c1`.*, `c0`.`product_id` as `fk__product_id`, `c0`.`category_id` as `fk__category_id` from `category_products` as `c0` inner join `category` as `c1` on `c0`.`category_id` = `c1`.`id` where `c0`.`product_id` in (1)");
    // It prints one row matching Product 1's category:
    /*
    [
      { id: 1, name: 'Category 1', fk__product_id: 1, fk__category_id: 1 }
    ]
    */
    console.log('non-dataloader query result:', rows);
  }

  // Then see the same but with dataloader enabled
  {
    const p1 = await orm.em.findOneOrFail(Product, { name: 'Product 1' });

    console.log('WITH DATALOADER:');
    await p1.categories.init({ dataloader: true });

    // This is the database query printed into the debug logs
    const rows = await orm.em.execute("select `c0`.*, `p1`.`id` as `p1__id`, `p1`.`name` as `p1__name` from `category` as `c0` left join `category_products` as `c2` on `c0`.`id` = `c2`.`category_id` left join `product` as `p1` on `c2`.`product_id` = `p1`.`id` left join `category_products` as `c3` on `c0`.`id` = `c3`.`category_id` where `c3`.`product_id` in (1)");
    // It prints 3 rows. They resolve correctly to just category 1, but due to the extra join (c3) in the query, the info gets duplicated per each product that's in category 1.
    /*
    [
      { id: 1, name: 'Category 1', p1__id: 1, p1__name: 'Product 1' },
      { id: 1, name: 'Category 1', p1__id: 2, p1__name: 'Product 2' },
      { id: 1, name: 'Category 1', p1__id: 3, p1__name: 'Product 3' }
    ]
    */
    console.log('dataloader query result:', rows);
  }
});

test('dataloader ref issue', async () => {
  {
    const p1 = orm.em.create(Product, { name: 'Product 1' });

    const c1 = orm.em.create(Category, { name: 'Category 1' });

    c1.products.add([p1]);
  }

  await orm.em.flush();
  orm.em.clear();

  {
    const p1 = await orm.em.findOneOrFail(Product, { name: 'Product 1' });

    // Using both dataloader and the "ref" option doesn't work here
    const promise = p1.categories.init({ dataloader: true, ref: true });
    await expect(promise).rejects.toThrow("Entity 'Category' does not have property ':ref'");
  }
});
