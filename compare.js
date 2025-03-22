class Node {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}

class LinkedList {
  constructor() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  append(value) {
    const newNode = new Node(value);
    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      this.tail.next = newNode;
      this.tail = newNode;
    }
    this.length++;
  }

  get(index) {
    if (index < 0 || index >= this.length) return null;
    let current = this.head;
    for (let i = 0; i < index; i++) {
      current = current.next;
    }
    return current.value;
  }
}

class HybridListA {
  constructor(interval = 3) {
    this.list = new LinkedList();
    this.indexArray = [];
    this.interval = interval;
  }

  append(value) {
    this.list.append(value);
    if (this.list.length % this.interval === 0) {
      this.indexArray.push(this.list.tail);
    }
  }

  get(index) {
    if (index < 0 || index >= this.list.length) return null;
    const arrayIndex = Math.floor(index / this.interval);
    let startNode = arrayIndex === 0 ? this.list.head : this.indexArray[arrayIndex - 1].next;
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
    this.list = new LinkedList();
    this.array = [];
  }

  append(value) {
    const newNode = new Node(value);
    if (!this.list.head) {
      this.list.head = newNode;
      this.list.tail = newNode;
    } else {
      this.list.tail.next = newNode;
      this.list.tail = newNode;
    }
    this.array.push(newNode);
    this.list.length++;
  }

  get(index) {
    if (index < 0 || index >= this.list.length) return null;
    return this.array[index].value;
  }
}

function getRandomIndex(max) {
  return Math.floor(Math.random() * max);
}

function runBenchmark(size, testCount, intervals, runNumber, results) {
  console.log(`Running benchmark ${runNumber}/${totalRuns} with size: ${size}, test count: ${testCount}`);
  
  const array = [];
  const linkedList = new LinkedList();
  const hybridListB = new HybridListB();
  
  const hybridListsA = {};
  intervals.forEach(interval => {
    hybridListsA[interval] = new HybridListA(interval);
  });

  for (let i = 0; i < size; i++) {
    const value = i;
    array.push(value);
    linkedList.append(value);
    hybridListB.append(value);
    
    intervals.forEach(interval => {
      hybridListsA[interval].append(value);
    });
  }

  const randomIndices = [];
  for (let i = 0; i < testCount; i++) {
    randomIndices.push(getRandomIndex(size));
  }

  let start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = array[index];
  }
  let end = performance.now();
  const arrayTime = end - start;
  results.array.push(arrayTime);
  console.log(`Array access time: ${arrayTime.toFixed(6)} ms`);

  start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = linkedList.get(index);
  }
  end = performance.now();
  const linkedListTime = end - start;
  results.linkedList.push(linkedListTime);
  console.log(`LinkedList access time: ${linkedListTime.toFixed(6)} ms`);

  start = performance.now();
  for (let i = 0; i < testCount; i++) {
    const index = randomIndices[i];
    const value = hybridListB.get(index);
  }
  end = performance.now();
  const hybridListBTime = end - start;
  results.hybridListB.push(hybridListBTime);
  console.log(`HybridListB access time: ${hybridListBTime.toFixed(6)} ms`);

  intervals.forEach(interval => {
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
  });
  
  console.log("----------------------------------------\n");
}

function calculateAndPrintAverages(results, totalRuns) {
  console.log("\n========= AVERAGE RESULTS =========");
  console.log(`Based on ${totalRuns} runs\n`);
  
  const avgArrayTime = results.array.reduce((sum, time) => sum + time, 0) / totalRuns;
  console.log(`Average Array access time: ${avgArrayTime.toFixed(6)} ms`);
  
  const avgLinkedListTime = results.linkedList.reduce((sum, time) => sum + time, 0) / totalRuns;
  console.log(`Average LinkedList access time: ${avgLinkedListTime.toFixed(6)} ms`);
  
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
    { name: "Array", time: avgArrayTime },
    { name: "HybridListB", time: avgHybridListBTime },
    { name: "LinkedList", time: avgLinkedListTime }
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
  console.log(`This is ${(avgLinkedListTime / bestTimeA).toFixed(2)}x faster than the regular LinkedList`);
  console.log(`This is ${(bestTimeA / avgArrayTime).toFixed(2)}x slower than the regular Array`);
  
  console.log(`\nHybridListB average access time: ${avgHybridListBTime.toFixed(6)} ms`);
  console.log(`This is ${(avgLinkedListTime / avgHybridListBTime).toFixed(2)}x faster than the regular LinkedList`);
  console.log(`This is ${(avgHybridListBTime / avgArrayTime).toFixed(2)}x slower than the regular Array`);
  
  console.log(`\nComparison: HybridListB is ${(bestTimeA / avgHybridListBTime).toFixed(2)}x ${bestTimeA > avgHybridListBTime ? 'slower' : 'faster'} than the best HybridListA (interval=${bestInterval})`);
}

const intervals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
const size = 50000;
const testCount = 50000;
const totalRuns = 10000;

const results = {
  array: [],
  linkedList: [],
  hybridListB: [],
  hybridListsA: {}
};

console.log(`Starting benchmark with ${totalRuns} runs...\n`);
for (let run = 1; run <= totalRuns; run++) {
  runBenchmark(size, testCount, intervals, run, results);
}

calculateAndPrintAverages(results, totalRuns);