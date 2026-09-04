const { searchDestination, calculateShipping } = require('./shipping');

async function test() {
    console.log("Mencari Tebet...");
    const dest = await searchDestination("tebet");
    const destId = dest[0].id || dest[0].subdistrict_id;
    console.log("Dest ID:", destId);
    
    console.log("\nOngkir 1kg (1000g):");
    const r1 = await calculateShipping(destId, 1000);
    console.log(r1.map(r => `${r.name} ${r.service}: ${r.cost || r.price}`));
    
    console.log("\nOngkir 12kg (12000g):");
    const r12 = await calculateShipping(destId, 12000);
    console.log(r12.map(r => `${r.name} ${r.service}: ${r.cost || r.price}`));
}

test();
