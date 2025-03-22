import { createHash } from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';

async function setupDatabase() {
    const db = await open({
        filename: './todos.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
            block_index INTEGER PRIMARY KEY,
            timestamp TEXT,
            data TEXT,
            hash TEXT,
            previous_hash TEXT
        )
    `);
    return db;
}

class Block {
    constructor(index, timestamp, data, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.data = data;
        this.previousHash = previousHash;
        this.hash = this.calculateHash();
    }

    calculateHash() {
        return createHash('sha256')
            .update(this.index + this.previousHash + this.timestamp + JSON.stringify(this.data))
            .digest('hex');
    }
}

class TodoChain {
    constructor(db) {
        this.chain = [];
        this.db = db;
    }

    async initialize() {
        const genesis = new Block(0, new Date().toISOString(), { task: "Todo Chain Started" }, "0");
        await this.saveToCache(genesis);
        this.chain = [genesis];
    }

    async saveToCache(block) {
        await this.db.run(`
            INSERT OR REPLACE INTO todos 
            (block_index, timestamp, data, hash, previous_hash) 
            VALUES (?, ?, ?, ?, ?)
        `, [
            block.index,
            block.timestamp,
            JSON.stringify(block.data),
            block.hash,
            block.previousHash
        ]);
    }

    async getLatestBlock() {
        const block = await this.db.get(`
            SELECT * FROM todos 
            ORDER BY block_index DESC 
            LIMIT 1
        `);
        return this.fromCacheToBlock(block);
    }

    async addBlock(newBlock) {
        newBlock.previousHash = (await this.getLatestBlock()).hash;
        newBlock.hash = newBlock.calculateHash();
        this.chain.push(newBlock);
        await this.saveToCache(newBlock);
    }

    async isChainValid() {
        const cachedBlocks = await this.db.all('SELECT * FROM todos ORDER BY block_index');
        for (let i = 1; i < cachedBlocks.length; i++) {
            const current = this.fromCacheToBlock(cachedBlocks[i]);
            const previous = this.fromCacheToBlock(cachedBlocks[i - 1]);
            if (current.hash !== current.calculateHash() || current.previousHash !== previous.hash) {
                return false;
            }
        }
        return true;
    }

    fromCacheToBlock(cached) {
        return new Block(
            cached.block_index,
            cached.timestamp,
            JSON.parse(cached.data),
            cached.previous_hash
        );
    }

    async getBlock(index) {
        const cached = await this.db.get('SELECT * FROM todos WHERE block_index = ?', index);
        if (!cached) throw new Error('Todo not found');
        const block = this.fromCacheToBlock(cached);
        if (block.hash !== block.calculateHash()) throw new Error('Todo data tampered');
        return block;
    }

    async getAllTodos() {
        const todos = await this.db.all('SELECT * FROM todos ORDER BY block_index');
        return todos.map(todo => this.fromCacheToBlock(todo));
    }

    async tamperBlock(index, newData) {
        await this.db.run(
            'UPDATE todos SET data = ? WHERE block_index = ?',
            [JSON.stringify(newData), index]
        );
    }
}

async function startServer() {
    const db = await setupDatabase();
    const todoChain = new TodoChain(db);
    await todoChain.initialize();

    const app = express();
    app.use(express.json());

    app.get('/todos', async (req, res) => {
        try {
            const todos = await todoChain.getAllTodos();
            res.json(todos);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/todos/:id', async (req, res) => {
        try {
            const block = await todoChain.getBlock(parseInt(req.params.id));
            res.json(block);
        } catch (error) {
            res.status(404).json({ error: error.message });
        }
    });

    app.post('/todos', async (req, res) => {
        try {
            const latest = await todoChain.getLatestBlock();
            const newBlock = new Block(
                latest.index + 1,
                new Date().toISOString(),
                { task: req.body.task, completed: false }
            );
            await todoChain.addBlock(newBlock);
            res.status(201).json(newBlock);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/todos/:id', async (req, res) => {
        try {
            const block = await todoChain.getBlock(parseInt(req.params.id));
            block.data = { task: req.body.task || block.data.task, completed: req.body.completed ?? block.data.completed };
            block.timestamp = new Date().toISOString();
            block.hash = block.calculateHash();
            await todoChain.saveToCache(block);
            res.json(block);
        } catch (error) {
            res.status(404).json({ error: error.message });
        }
    });

    app.delete('/todos/:id', async (req, res) => {
        try {
            await todoChain.db.run('DELETE FROM todos WHERE block_index = ?', req.params.id);
            todoChain.chain = await todoChain.getAllTodos();
            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/validate', async (req, res) => {
        const isValid = await todoChain.isChainValid();
        res.json({ valid: isValid });
    });

    app.get('/blocks', async (req, res) => {
        const blocks = await todoChain.getAllTodos();
        res.json(blocks);
    })

    app.post('/tamper/:id', async (req, res) => {
        try {
            const index = parseInt(req.params.id);
            const newData = req.body;
            await todoChain.tamperBlock(index, newData);
            res.json({ message: `Block ${index} tampered successfully` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.listen(3000, () => console.log('Server running on port 3000'));
}

startServer().catch(console.error);