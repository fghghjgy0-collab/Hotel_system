import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

// Initialize Anthropic client
const client = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey })
  : null;

/**
 * Parse natural language order text into structured menu items
 * Supports Nepali/English mixed text with fuzzy matching
 * 
 * @param {string} text - User's order in natural language
 * @param {Array} menu - Available menu items [{id, name, price, category, ...}]
 * @returns {Promise<{items: Array, unrecognized: Array} | null>} Parsed order or null on error
 */
export async function parseNaturalLanguageOrder(text, menu) {
  try {
    if (!client) {
      console.warn('Skipping AI order parsing because ANTHROPIC_API_KEY is not configured.');
      return null;
    }

    if (typeof text !== 'string' || !Array.isArray(menu)) {
      return null;
    }

    // Build menu reference string
    const menuStr = menu
      .map(item => `ID: ${item.id}, Name: ${item.name}, Category: ${item.category}, Price: ₹${item.price}`)
      .join('\n');

    const systemPrompt = `You are a helpful hotel restaurant AI assistant. Parse user orders from natural language text (may be in Nepali, English, or mixed).

Available menu items:
${menuStr}

Your task:
1. Identify which menu items the customer wants
2. Extract quantity for each item (default to 1 if not specified)
3. Return ONLY a JSON object with no other text

For fuzzy matching, consider:
- "chai" = any tea item
- "momo" = momo dishes
- "noodles" = chow mein
- "rice" = dal bhat
- Common Nepali dish names

Return JSON format EXACTLY:
{
  "items": [
    {"menu_item_id": 1, "name": "item name", "quantity": 2},
    {"menu_item_id": 3, "name": "item name", "quantity": 1}
  ],
  "unrecognized": ["words that didn't match any item"]
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Parse this order: "${text}"`
        }
      ],
      system: systemPrompt
    });

    // Extract text from response
    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Try to parse JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('Could not find JSON in AI response:', responseText);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and match items to actual menu
    if (parsed.items && Array.isArray(parsed.items)) {
      parsed.items = parsed.items.filter(item => {
        item.menu_item_id = Number(item.menu_item_id);
        item.quantity = Number.parseInt(item.quantity, 10) || 1;
        const menuItem = menu.find(m => m.id === item.menu_item_id);
        return menuItem !== undefined;
      });
    }

    return parsed;
  } catch (error) {
    console.error('Parse natural language order error:', error);
    return null;
  }
}

/**
 * Generate a warm closing message for the bill
 * 
 * @param {Array} items - Order items [{ name, quantity }]
 * @param {string} tableName - Table identifier
 * @param {number} total - Total bill amount in NPR
 * @returns {Promise<string>} Warm closing message or empty string on error
 */
export async function generateBillSummary(items, tableName, total) {
  try {
    if (!client) {
      return '';
    }

    const safeItems = Array.isArray(items) ? items : [];
    const itemsList = safeItems
      .map(item => {
        if (typeof item === 'string') return item;
        return `${item.quantity || 1}x ${item.name || item.menu_name || 'item'}`;
      })
      .join(', ');

    const systemPrompt = `You are a warm, friendly Nepali restaurant AI assistant. Generate a 2-sentence closing message for a guest's bill.
The message should:
1. Thank them warmly for their order
2. Wish them a nice experience or suggest visiting again
Keep it brief, warm, and natural. No emojis.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `The guest ordered: ${itemsList}. Total: ₹${total}. Generate a warm closing message.`
        }
      ],
      system: systemPrompt
    });

    const message = response.content[0].type === 'text' ? response.content[0].text : '';
    return message.trim();
  } catch (error) {
    console.error('Generate bill summary error:', error);
    return '';
  }
}

/**
 * Suggest complementary menu items based on current order
 * 
 * @param {Array} currentOrder - Currently ordered items [{ name }]
 * @param {Array} menu - Full menu
 * @returns {Promise<{suggestions: Array} | null>} Suggested items or null on error
 */
export async function suggestMenuItems(currentOrder, menu) {
  try {
    if (!client) {
      return { suggestions: [] };
    }

    const safeCurrentOrder = Array.isArray(currentOrder) ? currentOrder : [];
    const safeMenu = Array.isArray(menu) ? menu : [];

    const menuStr = safeMenu
      .map(item => `${item.name} (${item.category}) - ₹${item.price}`)
      .slice(0, 20) // Use top 20 items to keep prompt reasonable
      .join('\n');

    const currentStr = safeCurrentOrder
      .map(i => typeof i === 'string' ? i : i.name)
      .filter(Boolean)
      .join(', ');

    const systemPrompt = `You are a helpful restaurant AI. Given what a customer has already ordered, suggest 1-2 complementary items from the menu.

Menu items:
${menuStr}

Return ONLY a JSON object:
{
  "suggestions": [
    {"name": "item name", "reason": "Why this complements their order"},
    {"name": "item name", "reason": "Why this complements their order"}
  ]
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `They've ordered: ${currentStr}. What should they add?`
        }
      ],
      system: systemPrompt
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Suggest menu items error:', error);
    return null;
  }
}

export default {
  parseNaturalLanguageOrder,
  generateBillSummary,
  suggestMenuItems
};
