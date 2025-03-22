import sqlite3 from 'sqlite3';
sqlite3.verbose();
import { createHash } from 'crypto';
import fs from 'fs';
import { performance } from 'perf_hooks';

const LOG_FILE_PATH = 'blockchain_benchmark_log.txt';
const RESULTS_FILE_PATH = 'blockchain_benchmark_results.json';

function logToFile(message, logFilePath = LOG_FILE_PATH) {
  fs.appendFileSync(logFilePath, message + '\n');
  console.log(message);
}

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
  constructor(interval = 3, dbName = 'hybridA.db') {
    this.blockchain = new SecureBlockchain();
    this.interval = interval;
    this.dbName = dbName;
    this.db = new sqlite3.Database(dbName);
    
    this.db.serialize(() => {
      this.db.run('CREATE TABLE IF NOT EXISTS index_nodes (id INTEGER PRIMARY KEY, node_hash TEXT, node_data TEXT)');
    });
  }

  async reset() {
    return new Promise((resolve, reject) => {
      this.db.run('DROP TABLE IF EXISTS index_nodes', (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.db.run('CREATE TABLE IF NOT EXISTS index_nodes (id INTEGER PRIMARY KEY, node_hash TEXT, node_data TEXT)', (err) => {
          if (err) reject(err);
          else {
            this.blockchain = new SecureBlockchain();
            resolve();
          }
        });
      });
    });
  }

  append(value) {
    const node = this.blockchain.append(value);
    
    if (this.blockchain.length % this.interval === 0) {
      return new Promise((resolve, reject) => {
        const nodeData = {
          value: node.value,
          hash: node.hash,
          previousHash: node.previousHash,
          timestamp: node.timestamp
        };
        
        const stmt = this.db.prepare('INSERT INTO index_nodes (id, node_hash, node_data) VALUES (?, ?, ?)');
        const arrayIndex = Math.floor((this.blockchain.length - 1) / this.interval);
        
        stmt.run(arrayIndex, node.hash, JSON.stringify(nodeData), (err) => {
          if (err) reject(err);
          else resolve(this.blockchain.length - 1);
        });
        stmt.finalize();
      });
    }
    
    return Promise.resolve(this.blockchain.length - 1);
  }

  async get(index) {
    if (index < 0 || index >= this.blockchain.length) return null;
    
    const arrayIndex = Math.floor(index / this.interval);
    
    return new Promise((resolve, reject) => {
      this.db.get('SELECT node_data FROM index_nodes WHERE id <= ? ORDER BY id DESC LIMIT 1', [arrayIndex], async (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        let startNode;
        let startIndex;
        
        if (!row) {
          startNode = this.blockchain.head;
          startIndex = 0;
        } else {
          const nodeData = JSON.parse(row.node_data);
          
          let current = this.blockchain.head;
          let i = 0;
          
          while (current && current.hash !== nodeData.hash) {
            current = current.next;
            i++;
          }
          
          if (!current) {
            startNode = this.blockchain.head;
            startIndex = 0;
          } else {
            startNode = current;
            startIndex = Math.floor(i / this.interval) * this.interval;
          }
        }
        
        let current = startNode;
        for (let i = startIndex; i < index && current !== null; i++) {
          current = current.next;
        }
        
        if (current === null) {
          resolve(null);
        } else {
          resolve(current.value);
        }
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

class HybridListB {
  constructor(dbName = 'hybridB.db') {
    this.blockchain = new SecureBlockchain();
    this.dbName = dbName;
    this.db = new sqlite3.Database(dbName);
    
    this.db.serialize(() => {
      this.db.run('CREATE TABLE IF NOT EXISTS node_references (id INTEGER PRIMARY KEY, node_hash TEXT, node_data TEXT)');
    });
  }

  async reset() {
    return new Promise((resolve, reject) => {
      this.db.run('DROP TABLE IF EXISTS node_references', (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.db.run('CREATE TABLE IF NOT EXISTS node_references (id INTEGER PRIMARY KEY, node_hash TEXT, node_data TEXT)', (err) => {
          if (err) reject(err);
          else {
            this.blockchain = new SecureBlockchain();
            resolve();
          }
        });
      });
    });
  }

  append(value) {
    const node = this.blockchain.append(value);
    
    return new Promise((resolve, reject) => {
      const nodeData = {
        value: node.value,
        hash: node.hash,
        previousHash: node.previousHash,
        timestamp: node.timestamp
      };
      
      const stmt = this.db.prepare('INSERT INTO node_references (id, node_hash, node_data) VALUES (?, ?, ?)');
      stmt.run(this.blockchain.length - 1, node.hash, JSON.stringify(nodeData), (err) => {
        if (err) reject(err);
        else resolve(this.blockchain.length - 1);
      });
      stmt.finalize();
    });
  }

  async get(index) {
    if (index < 0 || index >= this.blockchain.length) return null;
    
    return new Promise((resolve, reject) => {
      this.db.get('SELECT node_data FROM node_references WHERE id = ?', [index], (err, row) => {
        if (err) reject(err);
        else if (!row) resolve(null);
        else {
          const nodeData = JSON.parse(row.node_data);
          resolve(nodeData.value);
        }
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

const getRandomIndex = max => Math.floor(Math.random() * max);

const runBenchmark = async (size, testCount, intervals, runNumber, results, totalRuns) => {
  logToFile(`Running benchmark ${runNumber}/${totalRuns} with size: ${size}, test count: ${testCount}`);
  
  const sqliteArray = new SQLiteArray(`test_run_${runNumber}.db`);
  await sqliteArray.reset();
  
  const blockchain = new SecureBlockchain();
  const hybridListB = new HybridListB(`hybridB_run_${runNumber}.db`);
  await hybridListB.reset();
  
  const hybridListsA = {};
  for (const interval of intervals) {
    hybridListsA[interval] = new HybridListA(interval, `hybridA_int${interval}_run_${runNumber}.db`);
    await hybridListsA[interval].reset();
  }

  logToFile("Populating data structures...");
  for (let i = 0; i < size; i++) {
    const value = { id: i, data: `Data-${i}` };
    await sqliteArray.append(value);
    blockchain.append(value);
    await hybridListB.append(value);
    
    for (const interval of intervals) {
      await hybridListsA[interval].append(value);
    }
    
    if (i % 1000 === 0) {
      logToFile(`Populated ${i} elements...`);
    }
  }

  const randomIndices = [];
  for (let i = 0; i < testCount; i++) {
    randomIndices.push(getRandomIndex(size));
  }

  logToFile("Testing SQLite Array...");
  let start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = await sqliteArray.get(index);
  }
  let end = performance.now();
  const sqliteTime = end - start;
  results.sqlite.push(sqliteTime);
  logToFile(`SQLite Array access time: ${sqliteTime.toFixed(6)} ms`);

  logToFile("Testing Secure Blockchain...");
  start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = blockchain.get(index);
  }
  end = performance.now();
  const blockchainTime = end - start;
  results.blockchain.push(blockchainTime);
  logToFile(`Secure Blockchain access time: ${blockchainTime.toFixed(6)} ms`);

  logToFile("Testing HybridListB...");
  start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = await hybridListB.get(index);
  }
  end = performance.now();
  const hybridListBTime = end - start;
  results.hybridListB.push(hybridListBTime);
  logToFile(`HybridListB access time: ${hybridListBTime.toFixed(6)} ms`);

  logToFile("Testing HybridListA with different intervals...");
  for (const interval of intervals) {
    start = performance.now();
    for (let i = 0; i < testCount; i++) {
      const index = randomIndices[i];
      const value = await hybridListsA[interval].get(index);
    }
    end = performance.now();
    const hybridTime = end - start;
    
    if (!results.hybridListsA[interval]) {
      results.hybridListsA[interval] = [];
    }
    results.hybridListsA[interval].push(hybridTime);
    
    logToFile(`HybridListA (interval=${interval}) access time: ${hybridTime.toFixed(6)} ms`);
  }
  
  await sqliteArray.close();
  await hybridListB.close();
  for (const interval of intervals) {
    await hybridListsA[interval].close();
  }
  
  try {
    fs.unlinkSync(sqliteArray.dbName);
    fs.unlinkSync(hybridListB.dbName);
    for (const interval of intervals) {
      fs.unlinkSync(hybridListsA[interval].dbName);
    }
    logToFile(`Cleaned up database files for run ${runNumber}`);
  } catch (err) {
    logToFile(`Error cleaning up database files: ${err.message}`);
  }
  
  logToFile("----------------------------------------\n");
};

const calculateAndPrintAverages = (results, totalRuns) => {
  logToFile("\n========= AVERAGE RESULTS =========");
  logToFile(`Based on ${totalRuns} runs\n`);
  
  const avgSQLiteTime = results.sqlite.reduce((sum, time) => sum + time, 0) / totalRuns;
  logToFile(`Average SQLite Array access time: ${avgSQLiteTime.toFixed(6)} ms`);
  
  const avgBlockchainTime = results.blockchain.reduce((sum, time) => sum + time, 0) / totalRuns;
  logToFile(`Average Secure Blockchain access time: ${avgBlockchainTime.toFixed(6)} ms`);
  
  const avgHybridListBTime = results.hybridListB.reduce((sum, time) => sum + time, 0) / totalRuns;
  logToFile(`Average HybridListB access time: ${avgHybridListBTime.toFixed(6)} ms`);
  
  const hybridAverages = {};
  for (const interval in results.hybridListsA) {
    const avgTime = results.hybridListsA[interval].reduce((sum, time) => sum + time, 0) / totalRuns;
    hybridAverages[interval] = avgTime;
    logToFile(`Average HybridListA (interval=${interval}) access time: ${avgTime.toFixed(6)} ms`);
  }
  
  logToFile("\n========= PERFORMANCE RANKING =========");
  logToFile("From fastest to slowest:\n");
  
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
    logToFile(`${index + 1}. ${result.name}: ${result.time.toFixed(6)} ms`);
  });
  
  logToFile("\n========= BEST HYBRID CONFIGURATION =========");
  const entries = Object.entries(hybridAverages);
  entries.sort((a, b) => a[1] - b[1]);
  
  const bestInterval = entries[0][0];
  const bestTimeA = entries[0][1];
  
  logToFile(`The best performing HybridListA has interval=${bestInterval} with average access time: ${bestTimeA.toFixed(6)} ms`);
  logToFile(`This is ${(avgBlockchainTime / bestTimeA).toFixed(2)}x faster than the regular Secure Blockchain`);
  logToFile(`This is ${(bestTimeA / avgSQLiteTime).toFixed(2)}x slower than the SQLite Array`);
  
  logToFile(`\nHybridListB average access time: ${avgHybridListBTime.toFixed(6)} ms`);
  logToFile(`This is ${(avgBlockchainTime / avgHybridListBTime).toFixed(2)}x faster than the regular Secure Blockchain`);
  logToFile(`This is ${(avgHybridListBTime / avgSQLiteTime).toFixed(2)}x slower than the SQLite Array`);
  
  logToFile(`\nComparison: HybridListB is ${(bestTimeA / avgHybridListBTime).toFixed(2)}x ${bestTimeA > avgHybridListBTime ? 'slower' : 'faster'} than the best HybridListA (interval=${bestInterval})`);
  
  return {
    bestInterval,
    bestTimeA,
    avgSQLiteTime,
    avgBlockchainTime,
    avgHybridListBTime,
    hybridAverages,
    allResults
  };
};

const saveResultsToFile = (results, totalRuns, averageSummary) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const fileName = RESULTS_FILE_PATH;
  
  const summaryResults = {
    timestamp,
    parameters: {
      size,
      testCount,
      totalRuns,
      intervals
    },
    averages: {
      sqlite: averageSummary.avgSQLiteTime,
      blockchain: averageSummary.avgBlockchainTime,
      hybridListB: averageSummary.avgHybridListBTime,
      hybridListsA: averageSummary.hybridAverages
    },
    bestConfiguration: {
      bestHybridAInterval: averageSummary.bestInterval,
      bestHybridATime: averageSummary.bestTimeA,
      comparedToBlockchain: (averageSummary.avgBlockchainTime / averageSummary.bestTimeA).toFixed(2),
      comparedToSQLite: (averageSummary.bestTimeA / averageSummary.avgSQLiteTime).toFixed(2),
      hybridBTime: averageSummary.avgHybridListBTime,
      hybridBComparedToBlockchain: (averageSummary.avgBlockchainTime / averageSummary.avgHybridListBTime).toFixed(2),
      hybridBComparedToSQLite: (averageSummary.avgHybridListBTime / averageSummary.avgSQLiteTime).toFixed(2),
      hybridBComparedToBestHybridA: (averageSummary.bestTimeA / averageSummary.avgHybridListBTime).toFixed(2)
    },
    ranking: averageSummary.allResults,
    rawData: results
  };
  
  fs.writeFileSync(fileName, JSON.stringify(summaryResults, null, 2));
  logToFile(`Results saved to ${fileName}`);
};

const cleanupDBFiles = () => {
  try {
    const files = fs.readdirSync('.');
    files.forEach(file => {
      if ((file.startsWith('test_run_') || file.startsWith('hybridA_') || file.startsWith('hybridB_')) && file.endsWith('.db')) {
        fs.unlinkSync(file);
        logToFile(`Cleaned up leftover database file: ${file}`);
      }
    });
  } catch (err) {
    logToFile('Error during final cleanup: ' + err);
  }
};

const intervals = [1, 2, 3, 4, 5, 10, 25, 50, 100];
const size = 10000;
const testCount = 10000;
const totalRuns = 100;

const results = {
  sqlite: [],
  blockchain: [],
  hybridListB: [],
  hybridListsA: {}
};

fs.writeFileSync(LOG_FILE_PATH, `Blockchain Benchmark started at ${new Date().toISOString()}\n`);
fs.writeFileSync(RESULTS_FILE_PATH, '{}');

logToFile(`Starting benchmark comparing SQLite, Blockchain, and Hybrid data structures...`);
logToFile(`Parameters: size=${size}, testCount=${testCount}, totalRuns=${totalRuns}`);
logToFile(`Intervals tested: ${intervals.join(', ')}`);

const runAllBenchmarks = async () => {
  logToFile("Cleaning up any existing database files...");
  cleanupDBFiles();
  
  const startTime = performance.now();
  
  for (let run = 1; run <= totalRuns; run++) {
    await runBenchmark(size, testCount, intervals, run, results, totalRuns);
  }
  
  const endTime = performance.now();
  const totalDuration = (endTime - startTime) / 1000;
  
  logToFile(`\nAll benchmarks completed in ${totalDuration.toFixed(2)} seconds`);
  
  const averageSummary = calculateAndPrintAverages(results, totalRuns);
  saveResultsToFile(results, totalRuns, averageSummary);
  
  logToFile("\nCleaning up remaining database files...");
  cleanupDBFiles();
  
  logToFile(`\nBenchmark completed at ${new Date().toISOString()}`);
};

runAllBenchmarks().catch(err => {
  logToFile(`ERROR: ${err.stack || err.message || err}`);
});