import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { dashboardQueryKey, restCountdown } from "../lib/dashboard-state";
import { createWriteQueue, acknowledgeConfirmed } from "../lib/local-write-queue";

const endAt = "2026-10-27T21:13:00+01:00";
const now = Date.parse("2026-10-27T22:06:00+01:00");
test("9h rest retains 8h07 remaining, anchored to shift end", () => {
  const r = restCountdown({endAt,plannedRestMin:540},false,now)!;
  assert.equal(r.remainingMin,487);
  assert.equal(r.target,Date.parse("2026-10-28T06:13:00+01:00"));
});
test("rest without a planned duration still displays elapsed time, not an invented legal target", () => {
  for (const plannedRestMin of [null,undefined,0,NaN]) {
    const r = restCountdown({endAt,plannedRestMin},false,now)!;
    assert.equal(r.elapsedMin,53); assert.equal(r.target,null); assert.equal(r.remainingMin,null);
  }
});
test("11h and weekly rest, completed rest and DST use actual elapsed time", () => {
  for (const duration of [660,1440,2700]) {
    assert.equal(restCountdown({endAt,plannedRestMin:duration},false,now)!.remainingMin,duration-53);
    assert.equal(restCountdown({endAt,plannedRestMin:duration},false,now+3000*60000)!.remainingMin,0);
  }
  assert.equal(restCountdown({endAt:"2026-10-25T01:00:00+02:00",plannedRestMin:540},false,Date.parse("2026-10-25T03:00:00+01:00"))!.remainingMin,360);
});
test("active shift, unknown end, future end and unfinished ferry do not produce a second rest panel", () => {
  assert.equal(restCountdown({endAt},true,now),null);
  assert.equal(restCountdown({endAt:"bad"},false,now),null);
  assert.equal(restCountdown({endAt},false,now-3600000),null);
  assert.equal(restCountdown({endAt,ferryPending:true},false,now),null);
  assert.ok(restCountdown({endAt,ferryPending:true,ferryRestCompleted:true},false,now));
});
test("two sync refreshes keep cached shift and rest visible instead of loading an empty screen", async () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  for (const name of ["jornada-abierta","last-closed"]) {
    const key = dashboardQueryKey(name,"driver-a");
    const data = {id:"shift",endAt,plannedRestMin:540};
    client.setQueryData(key,data);
    let complete!: (value: typeof data) => void;
    const observer = new QueryObserver(client,{queryKey:key,queryFn:()=>new Promise<typeof data>(resolve=>{complete=resolve;}),staleTime:Infinity});
    const unsubscribe = observer.subscribe(()=>{});
    for(let i=0;i<2;i++) {
      const refreshing = client.invalidateQueries({queryKey:key});
      assert.equal(observer.getCurrentResult().isLoading,false);
      assert.deepEqual(observer.getCurrentResult().data,data);
      complete(data); await refreshing;
    }
    assert.equal(client.getQueryData(dashboardQueryKey(name,"driver-b")),undefined);
    unsubscribe();
  }
  client.clear();
});
test("sync acknowledges only confirmed versions, keeping new and edited shifts pending", () => {
  const uploaded = {id:"old",updatedAt:"2026-10-27T12:00:00.000Z",syncStatus:"pending"};
  const edited = {...uploaded,id:"edit",updatedAt:"2026-10-27T12:01:00Z"};
  const started = {...uploaded,id:"new"};
  const result = acknowledgeConfirmed([uploaded,edited,started],[{...uploaded,updatedAt:"2026-10-27T12:00:00+00:00"},{...uploaded,id:"edit"}]);
  assert.deepEqual(result.map(x=>x.syncStatus),["synced","pending","pending"]);
  assert.equal(uploaded.syncStatus,"pending");
});
test("local sync merge and start are serialized, so a start cannot be overwritten by a stale snapshot", async () => {
  const run = createWriteQueue();
  let rows = ["old"];
  let release!:()=>void;
  const wait = new Promise<void>(resolve=>{release=resolve;});
  const sync = run(async()=>{const snapshot=[...rows]; await wait; rows=snapshot;});
  const start = run(async()=>{const snapshot=[...rows]; snapshot.push("new"); rows=snapshot;});
  await Promise.resolve(); release(); await Promise.all([sync,start]);
  assert.deepEqual(rows,["old","new"]);
});
test("simultaneous starts create once, and a failed write does not poison the queue", async () => {
  const run = createWriteQueue(); let open = false;
  const start = ()=>run(async()=>{if(open)throw Error("already open"); await Promise.resolve(); open=true;});
  const results=await Promise.allSettled([start(),start()]);
  assert.deepEqual(results.map(r=>r.status),["fulfilled","rejected"]);
  assert.equal(await run(async()=>"still usable"),"still usable");
});
