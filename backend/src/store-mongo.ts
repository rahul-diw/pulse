import { MongoClient } from 'mongodb';
import { ops, type Col, type ListOpts, type Store } from '../../shared/store';
class MongoCol<T> implements Col<T> {
  constructor(private c: any) {}
  async list(f: any = {}, o: ListOpts = {}) { let cur = this.c.find(f, { projection: { _id: 0 } }); if (o.sort) cur = cur.sort(o.sort); if (o.skip) cur = cur.skip(o.skip); if (o.limit) cur = cur.limit(o.limit); return (await cur.toArray()) as T[] }
  async get(f: any) { return (await this.c.findOne(f, { projection: { _id: 0 } })) as T | null }
  async insert(d: T) { await this.c.insertOne({ ...d }); return d }
  async update(f: any, u: any) { return (await this.c.findOneAndUpdate(f, ops(u), { returnDocument: 'after', projection: { _id: 0 } })) as T | null }
  async remove(f: any) { return (await this.c.deleteOne(f)).deletedCount > 0 }
  async count(f: any = {}) { return (await this.c.countDocuments(f)) as number }
}
export async function mongoStore(uri: string, dbName = 'dineo'): Promise<Store> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }); await client.connect(); const db = client.db(dbName);
  await Promise.all([db.collection('restaurants').createIndex({ slug: 1 }, { unique: true }), db.collection('staff').createIndex({ email: 1 }, { unique: true }), db.collection('items').createIndex({ rid: 1, id: 1 }), db.collection('orders').createIndex({ rid: 1, createdAt: -1 }), db.collection('orders').createIndex({ id: 1 }, { unique: true }), db.collection('events').createIndex({ rid: 1, at: -1 }), db.collection('logs').createIndex({ rid: 1, at: -1 })]);
  return { kind: 'mongo', col: (n: string) => new MongoCol(db.collection(n)) as Col<any>, close: () => client.close() };
}
