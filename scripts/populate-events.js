// File: scripts/populate-events.js
// This script processes the ticket data and populates the database with real events

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Import the Event model
const Event = require('../models/Event');

// Function to read and parse the CSV file
async function importEventsFromCSV(filePath) {
  const events = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Process each row from the CSV
        events.push({
          title: row.name,
          date: new Date(row.date),
          venue: row.venue_name,
          location: `${row.venue_city}, ${row.venue_state}`,
          description: `${row.genre} event at ${row.venue_name}`,
          imageUrl: `/images/events/${row.event_type.toLowerCase().replace(' & ', '-')}.jpg`,
          categories: [row.event_type, row.genre],
          basePrice: parseInt(row.general_price),
          premiumPrice: parseFloat(row.premium_price),
          vipPrice: parseFloat(row.vip_price),
          totalTickets: parseInt(row.total_tickets),
          availableTickets: parseInt(row.available_tickets),
          soldTickets: parseInt(row.sold_tickets),
          status: row.status,
          scrapeSource: 'ticket-data-analysis'
        });
      })
      .on('end', () => {
        console.log(`Successfully parsed ${events.length} events from CSV`);
        resolve(events);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Function to save events to the database
async function saveEventsToDB(events) {
  try {
    // Clear existing events first
    await Event.deleteMany({});
    console.log('Cleared existing events');
    
    // Insert the new events
    const result = await Event.insertMany(events);
    console.log(`Added ${result.length} events to the database`);
    
    return result;
  } catch (error) {
    console.error('Error saving events to database:', error);
    throw error;
  }
}

// Main function to import events
async function importEvents() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
   // File: scripts/populate-events.js
// Simplified import script that doesn't require csv-parser

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Import the Event model
const Event = require('../models/Event');

// Sample event data (pre-parsed from CSV)
const sampleEvents = [
  {
    title: "Electronic Concert in Newark",
    date: new Date("2025-05-12 23:27:57"),
    venue: "Prudential Center",
    location: "Newark, NJ",
    description: "Electronic event at Prudential Center",
    imageUrl: "/images/events/concert.jpg",
    categories: ["Concert", "Electronic"],
    basePrice: 74,
    premiumPrice: 140.76,
    vipPrice: 281.99,
    totalTickets: 17787,
    availableTickets: 12497,
    soldTickets: 5290,
    status: "On Sale",
    scrapeSource: "ticket-data-analysis"
  },
  {
    title: "Pop Concert in Los Angeles",
    date: new Date("2025-07-01 23:27:57"),
    venue: "Staples Center",
    location: "Los Angeles, CA",
    description: "Pop event at Staples Center",
    imageUrl: "/images/events/concert.jpg",
    categories: ["Concert", "Pop"],
    basePrice: 100,
    premiumPrice: 245.48,
    vipPrice: 480.67,
    totalTickets: 17662,
    availableTickets: 6118,
    soldTickets: 11544,
    status: "On Sale",
    scrapeSource: "ticket-data-analysis"
  },
  {
    title: "Film Festival Event in Los Angeles",
    date: new Date("2025-07-08 23:27:57"),
    venue: "Staples Center",
    location: "Los Angeles, CA",
    description: "Film Festival event at Staples Center",
    imageUrl: "/images/events/festival.jpg",
    categories: ["Festival", "Film Festival"],
    basePrice: 73,
    premiumPrice: 156.31,
    vipPrice: 298.82,
    totalTickets: 18880,
    availableTickets: 12596,
    soldTickets: 6284,
    status: "On Sale",
    scrapeSource: "ticket-data-analysis"
  },
  {
    title: "Magic Show Event in Las Vegas",
    date: new Date("2025-04-02 23:27:57"),
    venue: "T-Mobile Arena",
    location: "Las Vegas, NV",
    description: "Magic Show event at T-Mobile Arena",
    imageUrl: "/images/events/family.jpg",
    categories: ["Family", "Magic Show"],
    basePrice: 71,
    premiumPrice: 124.64,
    vipPrice: 306.23,
    totalTickets: 18944,
    availableTickets: 10407,
    soldTickets: 8537,
    status: "On Sale",
    scrapeSource: "ticket-data-analysis"
  },
  {
    title: "Film Festival Event in Las Vegas",
    date: new Date("2025-04-23 23:27:57"),
    venue: "T-Mobile Arena",
    location: "Las Vegas, NV",
    description: "Film Festival event at T-Mobile Arena",
    imageUrl: "/images/events/festival.jpg",
    categories: ["Festival", "Film Festival"],
    basePrice: 118,
    premiumPrice: 178.44,
    vipPrice: 423.26,
    totalTickets: 18417,
    availableTickets: 10317,
    soldTickets: 8100,
    status: "On Sale",
    scrapeSource: "ticket-data-analysis"
  }
];

// Function to save events to the database
async function saveEventsToDB(events) {
  try {
    // Clear existing events first
    await Event.deleteMany({});
    console.log('Cleared existing events');
    
    // Insert the new events
    const result = await Event.insertMany(events);
    console.log(`Added ${result.length} events to the database`);
    
    return result;
  } catch (error) {
    console.error('Error saving events to database:', error);
    throw error;
  }
}

// Main function to import events
async function importEvents() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Use the sample events data
    const events = sampleEvents;
    
    // Save events to database
    await saveEventsToDB(events);
    
    console.log('Event import completed successfully');
    
    // Disconnect from MongoDB
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error importing events:', error);
  }
}

// Run the import if this script is executed directly
if (require.main === module) {
  importEvents();
}

module.exports = { importEvents };