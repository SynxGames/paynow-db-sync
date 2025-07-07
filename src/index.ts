
import { config } from "dotenv";
import axios, { AxiosRequestConfig } from "axios";
import mysql from 'mysql2/promise';

config()

const STORE_ID = process.env.STORE_ID;
const API_KEY = process.env.PAYNOW_API_KEY;

if(!API_KEY || !STORE_ID) {
    console.error(`Missing Paynow API Key or Store ID in .env file!`);
    process.exit(1);
}

const POLL_INTERVAL_SECONDS = 300;

const BASE_URL = `https://api.paynow.gg/v1`
const ORDERS_URL = `${BASE_URL}/stores/${STORE_ID}/orders`

const STANDARD_REQUEST_CONFIG: AxiosRequestConfig<any> = {
    headers: {
        Authorization: `APIKey ${API_KEY}`,
        'Content-Type': 'application/json'
    }
}

// Stores the Amount, UUID, SubTotal, Total (after Tax) that we receive, and when it was completed
// This isn't the most robust thing in the world. If Paynow changes schema or adds stuff we need, will need to re-fetch orders
// But this is quick & easy for Grafana Integration
const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS paynow_orders (
    id VARCHAR(64) PRIMARY KEY, 
    minecraft_uuid UUID,
    subtotal_cents INT NOT NULL,
    total_cents INT NOT NULL,
    completed TIMESTAMP NOT NULL
);
`

interface OrderDatabaseSchema {
    order_id: string,
    minecraft_uuid: string,
    subtotal_amount: number,
    total_amount: number,
    completed: string
}

async function fetchAndPrintAllOrders() {

    const connection = await mysql.createConnection({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        port: parseInt(process.env.SQL_PORT || '3306'),
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DATABASE
    })

    connection.execute(TABLE_SQL);

    let hasMore = true;
    let afterId = null;
    let totalProcessed = 0;

    const processedOrders: OrderDatabaseSchema[] = []
    
    while (hasMore) {
        const params = {
            status: "completed",
            limit: 100,
            asc: true,
            after: null
        };
        
        if (afterId) {
            params.after = afterId;
        }
        
        console.log(`Fetching batch ${Math.floor(totalProcessed / 100) + 1}...`);
        
        const res = await axios.get(ORDERS_URL, {
            headers: {
                Authorization: `APIKey ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            params
        });
        
        if (!res.data || !Array.isArray(res.data)) {
            console.error(`Unexpected API Response:`, res.data);
            return;
        }
        
        for (const order of res.data) {

            const completedDate = new Date(order.completed_at).toISOString().slice(0, 19).replace('T', ' ');

            processedOrders.push({
                order_id: order.id,
                minecraft_uuid: order.customer.minecraft_uuid,
                subtotal_amount: order.subtotal_amount,
                total_amount: order.total_amount,
                completed: completedDate
            })
        }
        
        totalProcessed += res.data.length;
        
        hasMore = res.data.length === 100;
        
        if (hasMore) {
            afterId = res.data[res.data.length - 1].id;
            // Add Delay for Rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    if (processedOrders.length > 0) {
        console.log(`Inserting ${processedOrders.length} orders into database...`);
        
        // Create placeholder string for multiple rows: (?,?,?,?,?),(?,?,?,?,?)...
        const placeholders = processedOrders.map(() => '(?,?,?,?,?)').join(',');
        
        const insertQuery = `
            INSERT INTO paynow_orders (id, minecraft_uuid, subtotal_cents, total_cents, completed) 
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE 
                minecraft_uuid = VALUES(minecraft_uuid),
                subtotal_cents = VALUES(subtotal_cents),
                total_cents = VALUES(total_cents),
                completed = VALUES(completed)
        `;
        
        // Flatten the values array
        const values = processedOrders.flatMap(order => [
            order.order_id,
            order.minecraft_uuid,
            order.subtotal_amount,
            order.total_amount,
            order.completed
        ]);
        
        await connection.execute(insertQuery, values);
        console.log(`Successfully inserted/updated ${processedOrders.length} orders`);
    
    await connection.end();
    }
    
    console.log(`Finished processing ${totalProcessed} orders`);
}

fetchAndPrintAllOrders()