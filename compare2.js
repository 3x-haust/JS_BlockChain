import sqlite3 from 'sqlite3';
sqlite3.verbose();
import { createHash } from 'crypto';
import fs from 'fs';

class BlockchainNode {
  constructor(value, previousHash = '') {
    this.value = value;
    this.timestamp = Date.now();
    this.previousHash = previousHash;
    this.hash = this.calculateHash();
    this.next = null;
  }

  calculateHash() {
    return createHash('sha256')
      .update(this.previousHash + this.timestamp + JSON.stringify(this.value))
      .digest('hex');
  }

  verifyIntegrity() {
    return this.hash === this.calculateHash();
  }
}

class SecureBlockchain {
  constructor() {
    this.head = null;
    this.tail = null;
    this.length = 0;
    this.blockMap = new Map();
  }

  append(value) {
    const previousHash = this.tail ? this.tail.hash : '';
    const newNode = new BlockchainNode(value, previousHash);
    
    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      if (!this.verifyChainIntegrity()) {
        throw new Error("Blockchain integrity compromised!");
      }
      this.tail.next = newNode;
      this.tail = newNode;
    }
    
    this.blockMap.set(this.length, newNode);
    this.length++;
    return newNode;
  }

  get(index) {
    if (index < 0 || index >= this.length) return null;
    
    if (!this.verifyChainIntegrity()) {
      throw new Error("Blockchain integrity compromised!");
    }
    
    let current = this.head;
    for (let i = 0; i < index; i++) {
      current = current.next;
    }
    return current.value;
  }
  
  verifyChainIntegrity() {
    if (!this.head) return true;
    
    let current = this.head;
    let previousHash = '';
    
    while (current) {
      if (!current.verifyIntegrity()) {
        return false;
      }
      
      if (current.previousHash !== previousHash) {
        return false;
      }
      
      previousHash = current.hash;
      current = current.next;
    }
    
    return true;
  }
}

class SQLiteArray {
  constructor(dbName = 'test.db') {
    this.dbName = dbName;
    this.db = new sqlite3.Database(dbName);
    this.length = 0;
    
    this.db.serialize(() => {
      this.db.run('CREATE TABLE IF NOT EXISTS array_elements (id INTEGER PRIMARY KEY, value TEXT)');
    });
  }

  reset() {
    return new Promise((resolve, reject) => {
      this.db.run('DROP TABLE IF EXISTS array_elements', (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.db.run('CREATE TABLE IF NOT EXISTS array_elements (id INTEGER PRIMARY KEY, value TEXT)', (err) => {
          if (err) reject(err);
          else {
            this.length = 0;
            resolve();
          }
        });
      });
    });
  }

  append(value) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare('INSERT INTO array_elements (id, value) VALUES (?, ?)');
      stmt.run(this.length, JSON.stringify(value), (err) => {
        if (err) reject(err);
        else {
          this.length++;
          resolve(this.length - 1);
        }
      });
      stmt.finalize();
    });
  }

  get(index) {
    return new Promise((resolve, reject) => {
      if (index < 0 || index >= this.length) {
        resolve(null);
        return;
      }
      
      this.db.get('SELECT value FROM array_elements WHERE id = ?', [index], (err, row) => {
        if (err) reject(err);
        else if (!row) resolve(null);
        else resolve(JSON.parse(row.value));
      });
    });
  }
  
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

class HybridListA {
  constructor(interval = 3) {
    this.blockchain = new SecureBlockchain();
    this.indexArray = [];
    this.interval = interval;
  }

  append(value) {
    const node = this.blockchain.append(value);
    if (this.blockchain.length % this.interval === 0) {
      this.indexArray.push(node);
    }
    return this.blockchain.length - 1;
  }

  get(index) {
    if (index < 0 || index >= this.blockchain.length) return null;
    const arrayIndex = Math.floor(index / this.interval);
    let startNode = arrayIndex === 0 ? this.blockchain.head : this.indexArray[arrayIndex - 1].next;
    let startIndex = arrayIndex * this.interval;
    let current = startNode;
    for (let i = startIndex; i < index; i++) {
      current = current.next;
    }
    return current.value;
  }
}

class HybridListB {
  constructor() {
    this.blockchain = new SecureBlockchain();
    this.array = [];
  }

  append(value) {
    const node = this.blockchain.append(value);
    this.array.push(node);
    return this.blockchain.length - 1;
  }

  get(index) {
    if (index < 0 || index >= this.blockchain.length) return null;
    return this.array[index].value;
  }
}

const getRandomIndex = max => Math.floor(Math.random() * max);

const runBenchmark = async (size, testCount, intervals, runNumber, results) => {
  console.log(`Running benchmark ${runNumber}/${totalRuns} with size: ${size}, test count: ${testCount}`);
  
  const sqliteArray = new SQLiteArray(`test_run_${runNumber}.db`);
  await sqliteArray.reset();
  
  const blockchain = new SecureBlockchain();
  const hybridListB = new HybridListB();
  
  const hybridListsA = {};
  intervals.forEach(interval => {
    hybridListsA[interval] = new HybridListA(interval);
  });

  console.log("Populating data structures...");
  for (let i = 0; i < size; i++) {
    const value = { id: i, data: `Data-${i}` };
    await sqliteArray.append(value);
    blockchain.append(value);
    hybridListB.append(value);
    
    intervals.forEach(interval => {
      hybridListsA[interval].append(value);
    });
    
    if (i % 1000 === 0) {
      console.log(`Populated ${i} elements...`);
    }
  }

  const randomIndices = [];
  for (let i = 0; i < testCount; i++) {
    randomIndices.push(getRandomIndex(size));
  }

  console.log("Testing SQLite Array...");
  let start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = await sqliteArray.get(index);
  }
  let end = performance.now();
  const sqliteTime = end - start;
  results.sqlite.push(sqliteTime);
  console.log(`SQLite Array access time: ${sqliteTime.toFixed(6)} ms`);

  console.log("Testing Secure Blockchain...");
  start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = blockchain.get(index);
  }
  end = performance.now();
  const blockchainTime = end - start;
  results.blockchain.push(blockchainTime);
  console.log(`Secure Blockchain access time: ${blockchainTime.toFixed(6)} ms`);

  console.log("Testing HybridListB...");
  start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = hybridListB.get(index);
  }
  end = performance.now();
  const hybridListBTime = end - start;
  results.hybridListB.push(hybridListBTime);
  console.log(`HybridListB access time: ${hybridListBTime.toFixed(6)} ms`);

  console.log("Testing HybridListA with different intervals...");
  for (const interval of intervals) {
    start = performance.now();
    for (let i = 0; i < testCount; i++) {
      const index = randomIndices[i];
      const value = hybridListsA[interval].get(index);
    }
    end = performance.now();
    const hybridTime = end - start;
    
    if (!results.hybridListsA[interval]) {
      results.hybridListsA[interval] = [];
    }
    results.hybridListsA[interval].push(hybridTime);
    
    console.log(`HybridListA (interval=${interval}) access time: ${hybridTime.toFixed(6)} ms`);
  }
  
  await sqliteArray.close();
  
  try {
    fs.unlinkSync(sqliteArray.dbName);
    console.log(`Cleaned up database file: ${sqliteArray.dbName}`);
  } catch (err) {
    console.error(`Error cleaning up database file: ${err.message}`);
  }
  
  console.log("----------------------------------------\n");
};

const calculateAndPrintAverages = (results, totalRuns) => {
  console.log("\n========= AVERAGE RESULTS =========");
  console.log(`Based on ${totalRuns} runs\n`);
  
  const avgSQLiteTime = results.sqlite.reduce((sum, time) => sum + time, 0) / totalRuns;
  console.log(`Average SQLite Array access time: ${avgSQLiteTime.toFixed(6)} ms`);
  
  const avgBlockchainTime = results.blockchain.reduce((sum, time) => sum + time, 0) / totalRuns;
  console.log(`Average Secure Blockchain access time: ${avgBlockchainTime.toFixed(6)} ms`);
  
  const avgHybridListBTime = results.hybridListB.reduce((sum, time) => sum + time, 0) / totalRuns;
  console.log(`Average HybridListB access time: ${avgHybridListBTime.toFixed(6)} ms`);
  
  const hybridAverages = {};
  for (const interval in results.hybridListsA) {
    const avgTime = results.hybridListsA[interval].reduce((sum, time) => sum + time, 0) / totalRuns;
    hybridAverages[interval] = avgTime;
    console.log(`Average HybridListA (interval=${interval}) access time: ${avgTime.toFixed(6)} ms`);
  }
  
  console.log("\n========= PERFORMANCE RANKING =========");
  console.log("From fastest to slowest:\n");
  
  const allResults = [
    { name: "SQLite Array", time: avgSQLiteTime },
    { name: "Secure Blockchain", time: avgBlockchainTime },
    { name: "HybridListB", time: avgHybridListBTime }
  ];
  
  for (const interval in hybridAverages) {
    allResults.push({ name: `HybridListA (interval=${interval})`, time: hybridAverages[interval] });
  }
  
  allResults.sort((a, b) => a.time - b.time);
  
  allResults.forEach((result, index) => {
    console.log(`${index + 1}. ${result.name}: ${result.time.toFixed(6)} ms`);
  });
  
  console.log("\n========= BEST HYBRID CONFIGURATION =========");
  const entries = Object.entries(hybridAverages);
  entries.sort((a, b) => a[1] - b[1]);
  
  const bestInterval = entries[0][0];
  const bestTimeA = entries[0][1];
  
  console.log(`The best performing HybridListA has interval=${bestInterval} with average access time: ${bestTimeA.toFixed(6)} ms`);
  console.log(`This is ${(avgBlockchainTime / bestTimeA).toFixed(2)}x faster than the regular Secure Blockchain`);
  console.log(`This is ${(bestTimeA / avgSQLiteTime).toFixed(2)}x slower than the SQLite Array`);
  
  console.log(`\nHybridListB average access time: ${avgHybridListBTime.toFixed(6)} ms`);
  console.log(`This is ${(avgBlockchainTime / avgHybridListBTime).toFixed(2)}x faster than the regular Secure Blockchain`);
  console.log(`This is ${(avgHybridListBTime / avgSQLiteTime).toFixed(2)}x slower than the SQLite Array`);
  
  console.log(`\nComparison: HybridListB is ${(bestTimeA / avgHybridListBTime).toFixed(2)}x ${bestTimeA > avgHybridListBTime ? 'slower' : 'faster'} than the best HybridListA (interval=${bestInterval})`);
};

const cleanupDBFiles = () => {
  try {
    const files = fs.readdirSync('.');
    files.forEach(file => {
      if (file.startsWith('test_run_') && file.endsWith('.db')) {
        fs.unlinkSync(file);
        console.log(`Cleaned up leftover database file: ${file}`);
      }
    });
  } catch (err) {
    console.error('Error during final cleanup:', err);
  }
};

const intervals = [1, 2, 3, 4, 5, 10, 25, 50, 100];
const size = 10000;
const testCount = 10000;
const totalRuns = 3;

const results = {
  sqlite: [],
  blockchain: [],
  hybridListB: [],
  hybridListsA: {}
};

console.log(`Starting benchmark comparing SQLite, Blockchain, and Hybrid data structures...`);
console.log(`Parameters: size=${size}, testCount=${testCount}, totalRuns=${totalRuns}`);

const runAllBenchmarks = async () => {
  cleanupDBFiles();
  
  for (let run = 1; run <= totalRuns; run++) {
    await runBenchmark(size, testCount, intervals, run, results);
  }
  calculateAndPrintAverages(results, totalRuns);
  
  cleanupDBFiles();
};

runAllBenchmarks().catch(console.error);