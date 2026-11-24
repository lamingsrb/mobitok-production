// Bound the serialized request as well as row count: source payload sizes vary.
export function* sourceStageBatches<T>(rows:Iterable<T>):Generator<T[]> {
  let batch:T[]=[],bytes=2;
  for(const row of rows){
    const size=Buffer.byteLength(JSON.stringify(row),"utf8");
    if(size+2>2_000_000)throw new Error("Artikal dobavlja\u010da je prevelik. Prethodni katalog je sa\u010duvan.");
    if(batch.length&&(batch.length>=400||bytes+size+1>2_000_000)){
      yield batch;batch=[];bytes=2;
    }
    batch.push(row);bytes+=size+(batch.length>1?1:0);
  }
  if(batch.length)yield batch;
}
