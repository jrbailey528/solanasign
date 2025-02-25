// scraper-service.js
// This file contains the event data scraping functionality for SolanaSign

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);

// Load environment variables
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Event Schema
const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: Date, required: true },
  venue: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String },
  categories: [{ type: String }],
  basePrice: { type: Number, required: true },
  totalTickets: { type: Number, required: true },
  availableTickets: { type: Number, required: true },
  scrapeSource: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Event = mongoose.model('Event', eventSchema);

// Target sites to scrape
const targetSites = [
  {
    name: 'concerts-example',
    url: 'https://www.example-concerts.com/events',
    type: 'static', // static HTML that can be scraped with cheerio
    eventSelector: '.event-item',
    dataSelectors: {
      title: '.event-title',
      date: '.event-date',
      venue: '.event-venue',
      location: '.event-location',
      description: '.event-description',
      imageUrl: '.event-image img',
      imageUrlAttr: 'src',
      price: '.event-price',
      categories: '.event-category'
    }
  },
  {
    name: 'sports-example',
    url: 'https://www.example-sports.com/tickets',
    type: 'dynamic', // dynamic content requiring puppeteer
    waitForSelector: '.event-container',
    eventSelector: '.event-card',
    dataSelectors: {
      title: '.card-title',
      date: '.event-datetime',
      venue: '.venue-name',
      location: '.venue-location',
      description: '.event-details',
      imageUrl: '.event-image',
      imageUrlAttr: 'style', // e.g. background-image: url('...')
      price: '.ticket-price',
      categories: '.event-type'
    },
    // Function to extract image URL from style attribute
    imageUrlTransform: (value) => {
      const match = value.match(/url\(['"](.+)['"]\)/);
      return match ? match[1] : '';
    }
  }
];

// Helper function to clean text
const cleanText = (text) => {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
};

// Helper function to parse price
const parsePrice = (priceText) => {
  if (!priceText) return 0;
  const match = priceText.match(/[\d,.]+/);
  if (!match) return 0;
  return parseFloat(match[0].replace(/,/g, ''));
};

// Helper function to parse date
const parseDate = (dateText) => {
  if (!dateText) return new Date();
  
  // Try various formats
  const date = new Date(dateText);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Handle more specific formats if needed
  // Example: "Sept 15, 2025 • 8:00 PM"
  const dateTimeMatch = dateText.match(/([A-Za-z]+)\s+(\d+),\s+(\d+)(?:\s+•\s+(\d+):(\d+)\s+(AM|PM))?/);
  if (dateTimeMatch) {
    const [_, month, day, year, hours, minutes, ampm] = dateTimeMatch;
    const monthNames = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5, 
      'jul': 6, 'aug': 7, 'sep': 8, 'sept': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    
    const monthNum = monthNames[month.toLowerCase().substring(0, 3)];
    let hour = parseInt(hours) || 0;
    const minute = parseInt(minutes) || 0;
    
    // Convert 12-hour to 24-hour format
    if (ampm && ampm.toUpperCase() === 'PM' && hour < 12) {
      hour += 12;
    } else if (ampm && ampm.toUpperCase() === 'AM' && hour === 12) {
      hour = 0;
    }
    
    return new Date(parseInt(year), monthNum, parseInt(day), hour, minute);
  }
  
  // Default to current date if parsing fails
  console.warn(`Failed to parse date: ${dateText}`);
  return new Date();
};

// Scrape static HTML site
const scrapeStaticSite = async (site) => {
  try {
    console.log(`Scraping static site: ${site.name}`);
    
    const response = await axios.get(site.url);
    const $ = cheerio.load(response.data);
    
    const events = [];
    
    $(site.eventSelector).each((index, element) => {
      const selectors = site.dataSelectors;
      
      // Extract basic event data
      const title = cleanText($(element).find(selectors.title).text());
      const dateText = cleanText($(element).find(selectors.date).text());
      const venue = cleanText($(element).find(selectors.venue).text());
      const location = cleanText($(element).find(selectors.location).text());
      const description = cleanText($(element).find(selectors.description).text());
      
      // Extract image URL
      let imageUrl = '';
      if (selectors.imageUrl) {
        const imgElement = $(element).find(selectors.imageUrl);
        if (selectors.imageUrlAttr) {
          imageUrl = imgElement.attr(selectors.imageUrlAttr) || '';
        } else {
          imageUrl = imgElement.attr('src') || '';
        }
        
        // Apply transform if defined
        if (site.imageUrlTransform && typeof site.imageUrlTransform === 'function') {
          imageUrl = site.imageUrlTransform(imageUrl);
        }
      }
      
      // Extract price
      const priceText = cleanText($(element).find(selectors.price).text());
      const price = parsePrice(priceText);
      
      // Extract categories
      const categories = [];
      $(element).find(selectors.categories).each((i, catElement) => {
        categories.push(cleanText($(catElement).text()));
      });
      
      // Parse date
      const date = parseDate(dateText);
      
      // Skip if missing critical data
      if (!title || !venue) {
        console.log(`Skipping event with missing data: ${title || 'Untitled'}`);
        return;
      }
      
      events.push({
        title,
        date,
        venue,
        location,
        description: description || `Event at ${venue}`,
        imageUrl,
        categories,
        basePrice: price,
        totalTickets: Math.floor(Math.random() * 1000) + 500, // Random for simulation
        availableTickets: Math.floor(Math.random() * 500) + 200, // Random for simulation
        scrapeSource: site.name
      });
    });
    
    console.log(`Scraped ${events.length} events from ${site.name}`);
    return events;
  } catch (error) {
    console.error(`Error scraping static site ${site.name}:`, error);
    return [];
  }
};

// Scrape dynamic site with Puppeteer
const scrapeDynamicSite = async (site) => {
  let browser = null;
  
  try {
    console.log(`Scraping dynamic site: ${site.name}`);
    
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Navigate to URL
    await page.goto(site.url, { waitUntil: 'networkidle2' });
    
    // Wait for content to load
    if (site.waitForSelector) {
      await page.waitForSelector(site.waitForSelector);
    } else {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Scroll to load more content if needed
    await autoScroll(page);
    
    // Extract events
    const events = await page.evaluate((siteInfo) => {
      const eventElements = document.querySelectorAll(siteInfo.eventSelector);
      const extractedEvents = [];
      
      for (const element of eventElements) {
        const selectors = siteInfo.dataSelectors;
        
        // Helper function to extract text
        const getText = (selector) => {
          const el = element.querySelector(selector);
          return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
        };
        
        // Helper function to extract attribute
        const getAttr = (selector, attr) => {
          const el = element.querySelector(selector);
          return el ? el.getAttribute(attr) : '';
        };
        
        // Extract basic event data
        const title = getText(selectors.title);
        const dateText = getText(selectors.date);
        const venue = getText(selectors.venue);
        const location = getText(selectors.location);
        const description = getText(selectors.description);
        
        // Extract image URL
        let imageUrl = '';
        if (selectors.imageUrl) {
          if (selectors.imageUrlAttr) {
            imageUrl = getAttr(selectors.imageUrl, selectors.imageUrlAttr);
          } else {
            imageUrl = getAttr(selectors.imageUrl, 'src');
          }
        }
        
        // Extract price
        const priceText = getText(selectors.price);
        
        // Extract categories
        const categories = [];
        const categoryElements = element.querySelectorAll(selectors.categories);
        for (const catEl of categoryElements) {
          categories.push(catEl.textContent.trim());
        }
        
        // Skip if missing critical data
        if (!title || !venue) {
          continue;
        }
        
        extractedEvents.push({
          title,
          dateText,
          venue,
          location,
          description,
          imageUrl,
          priceText,
          categories
        });
      }
      
      return extractedEvents;
    }, site);
    
    // Process the extracted events
    const processedEvents = events.map(event => {
      // Parse price
      const price = parsePrice(event.priceText);
      
      // Parse date
      const date = parseDate(event.dateText);
      
      return {
        title: event.title,
        date,
        venue: event.venue,
        location: event.location,
        description: event.description || `Event at ${event.venue}`,
        imageUrl: event.imageUrl,
        categories: event.categories,
        basePrice: price,
        totalTickets: Math.floor(Math.random() * 1000) + 500, // Random for simulation
        availableTickets: Math.floor(Math.random() * 500) + 200, // Random for simulation
        scrapeSource: site.name
      };
    });
    
    console.log(`Scraped ${processedEvents.length} events from ${site.name}`);
    return processedEvents;
  } catch (error) {
    console.error(`Error scraping dynamic site ${site.name}:`, error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// Helper function to auto-scroll in Puppeteer
const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        
        if (totalHeight >= scrollHeight || totalHeight > 10000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
};

// Save events to database
const saveEventsToDB = async (events) => {
  try {
    let savedCount = 0;
    let updatedCount = 0;
    
    for (const eventData of events) {
      // Check if event already exists
      const existingEvent = await Event.findOne({
        title: eventData.title,
        venue: eventData.venue,
        date: {
          $gte: new Date(eventData.date.getTime() - 24 * 60 * 60 * 1000),
          $lte: new Date(eventData.date.getTime() + 24 * 60 * 60 * 1000)
        }
      });
      
      if (!existingEvent) {
        // Create new event
        const newEvent = new Event(eventData);
        await newEvent.save();
        savedCount++;
      } else {
        // Update existing event (optional)
        // You can decide what fields to update based on your requirements
        existingEvent.description = eventData.description;
        existingEvent.imageUrl = eventData.imageUrl || existingEvent.imageUrl;
        existingEvent.basePrice = eventData.basePrice || existingEvent.basePrice;
        existingEvent.updatedAt = new Date();
        
        await existingEvent.save();
        updatedCount++;
      }
    }
    
    console.log(`Database update complete: ${savedCount} new events saved, ${updatedCount} events updated`);
    return { savedCount, updatedCount };
  } catch (error) {
    console.error('Error saving events to database:', error);
    throw error;
  }
};

// Main scraping function
const scrapeAllSites = async () => {
  try {
    console.log('Starting event scraping process...');
    
    // Create log directory if it doesn't exist
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    
    // Track statistics
    const stats = {
      startTime: new Date(),
      sites: {},
      totalEventsScraped: 0,
      totalEventsSaved: 0,
      totalEventsUpdated: 0,
      errors: []
    };
    
    // Process each target site
    for (const site of targetSites) {
      try {
        console.log(`Processing site: ${site.name}`);
        
        let events = [];
        
        if (site.type === 'static') {
          events = await scrapeStaticSite(site);
        } else if (site.type === 'dynamic') {
          events = await scrapeDynamicSite(site);
        }
        
        if (events.length > 0) {
          // Save events to database
          const dbResult = await saveEventsToDB(events);
          
          // Update stats
          stats.sites[site.name] = {
            eventsScraped: events.length,
            eventsSaved: dbResult.savedCount,
            eventsUpdated: dbResult.updatedCount
          };
          
          stats.totalEventsScraped += events.length;
          stats.totalEventsSaved += dbResult.savedCount;
          stats.totalEventsUpdated += dbResult.updatedCount;
        } else {
          stats.sites[site.name] = {
            eventsScraped: 0,
            eventsSaved: 0,
            eventsUpdated: 0
          };
        }
      } catch (error) {
        console.error(`Error processing site ${site.name}:`, error);
        stats.errors.push({
          site: site.name,
          message: error.message,
          stack: error.stack
        });
      }
    }
    
    // Complete stats
    stats.endTime = new Date();
    stats.duration = (stats.endTime - stats.startTime) / 1000; // in seconds
    
    // Save log
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const logFile = path.join(logDir, `scrape-log-${timestamp}.json`);
    await writeFileAsync(logFile, JSON.stringify(stats, null, 2));
    
    console.log(`Scraping process completed in ${stats.duration} seconds`);
    console.log(`Total events scraped: ${stats.totalEventsScraped}`);
    console.log(`Total events saved: ${stats.totalEventsSaved}`);
    console.log(`Total events updated: ${stats.totalEventsUpdated}`);
    console.log(`Errors: ${stats.errors.length}`);
    console.log(`Log saved to: ${logFile}`);
    
    return stats;
  } catch (error) {
    console.error('Error in scraping process:', error);
    throw error;
  }
};

// Ticketmaster-like site scraper (example implementation)
const scrapeTicketmasterLike = async () => {
  try {
    console.log('Scraping Ticketmaster-like site...');
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Navigate to a site similar to Ticketmaster
    await page.goto('https://example-ticketing-site.com', { waitUntil: 'networkidle2' });
    
    // Accept cookies if needed
    try {
      const cookieButton = await page.$('button[data-accept-cookies="true"]');
      if (cookieButton) {
        await cookieButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      console.log('No cookie consent needed or not found');
    }
    
    // Search for events in popular cities
    const cities = ['New York', 'Los Angeles', 'Chicago', 'Miami', 'Las Vegas'];
    
    let allEvents = [];
    
    for (const city of cities) {
      console.log(`Searching events in ${city}...`);
      
      // Clear and fill search box
      await page.click('#search-input');
      await page.keyboard.type(city);
      await page.click('#search-button');
      
      // Wait for results
      await page.waitForSelector('.search-results', { timeout: 30000 });
      
      // Allow some time for results to load
      await page.waitForTimeout(3000);
      
      // Extract events
      const cityEvents = await page.evaluate(() => {
        const eventCards = document.querySelectorAll('.event-card');
        return Array.from(eventCards).map(card => {
          return {
            title: card.querySelector('.event-name')?.textContent.trim() || '',
            dateText: card.querySelector('.event-date')?.textContent.trim() || '',
            venue: card.querySelector('.venue-name')?.textContent.trim() || '',
            location: card.querySelector('.venue-location')?.textContent.trim() || '',
            priceText: card.querySelector('.ticket-price')?.textContent.trim() || '',
            imageUrl: card.querySelector('.event-image img')?.src || '',
            eventUrl: card.querySelector('a.event-link')?.href || ''
          };
        });
      });
      
      console.log(`Found ${cityEvents.length} events in ${city}`);
      
      // Process event details
      for (let i = 0; i < Math.min(cityEvents.length, 10); i++) {
        const event = cityEvents[i];
        
        // Skip if missing critical data
        if (!event.title || !event.venue) {
          continue;
        }
        
        // Visit event page for more details
        if (event.eventUrl) {
          await page.goto(event.eventUrl, { waitUntil: 'networkidle2' });
          
          // Extract additional details
          const details = await page.evaluate(() => {
            return {
              description: document.querySelector('.event-description')?.textContent.trim() || '',
              categories: Array.from(document.querySelectorAll('.event-category')).map(el => el.textContent.trim()),
              totalSeats: document.querySelector('.total-seats')?.textContent.trim() || ''
            };
          });
          
          // Combine data
          event.description = details.description;
          event.categories = details.categories;
          
          // Extract total tickets from text like "Total seats: 2500"
          const totalTicketsMatch = details.totalSeats.match(/\d+/);
          event.totalTickets = totalTicketsMatch ? parseInt(totalTicketsMatch[0]) : 1000;
          
          // For available tickets, generate a random number less than total
          event.availableTickets = Math.floor(Math.random() * event.totalTickets * 0.7);
          
          // Parse date
          event.date = parseDate(event.dateText);
          
          // Parse price
          event.basePrice = parsePrice(event.priceText);
          
          // Add to events array with additional fields for DB
          allEvents.push({
            title: event.title,
            date: event.date,
            venue: event.venue,
            location: event.location || city,
            description: event.description || `Event at ${event.venue}`,
            imageUrl: event.imageUrl,
            categories: event.categories,
            basePrice: event.basePrice,
            totalTickets: event.totalTickets,
            availableTickets: event.availableTickets,
            scrapeSource: 'ticketmaster-like'
          });
          
          // Navigate back or wait before next event
          await page.waitForTimeout(1000);
        }
      }
      
      // Navigate back to search
      await page.goto('https://example-ticketing-site.com', { waitUntil: 'networkidle2' });
    }
    
    await browser.close();
    
    console.log(`Scraped ${allEvents.length} events from Ticketmaster-like site`);
    return allEvents;
  } catch (error) {
    console.error('Error scraping Ticketmaster-like site:', error);
    return [];
  }
};

// Schedule scraping job
const scheduleScraping = () => {
  // Run every day at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running scheduled scraping job...');
      await scrapeAllSites();
    } catch (error) {
      console.error('Error in scheduled scraping job:', error);
    }
  });
  
  console.log('Scraping job scheduled to run every day at midnight');
};

// Run scraping immediately when script is executed
if (require.main === module) {
  console.log('Starting initial scraping...');
  scrapeAllSites()
    .then(() => {
      console.log('Initial scraping completed');
      scheduleScraping();
    })
    .catch(error => {
      console.error('Error in initial scraping:', error);
      scheduleScraping();
    });
} else {
  // When imported as a module
  scheduleScraping();
}

module.exports = {
  scrapeAllSites,
  scrapeTicketmasterLike,
  scheduleScraping
};