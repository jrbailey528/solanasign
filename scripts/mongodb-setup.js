// .env file configuration
// Create a .env file in the root of your project with these variables

PORT=5000
MONGODB_URI=mongodb://localhost:27017/solanasign
JWT_SECRET=your_jwt_secret_key_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
AUTHORITY_PRIVATE_KEY=123,456,789... # Your private key as comma-separated bytes
CREATOR_ADDRESS=your_solana_wallet_address_here

// mongodb-setup.js
// Script to initialize database with sample data

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Define schemas (simplified versions of those in server.js)
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  walletAddress: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const eventSchema = new mongoose.Schema({
  title: String,
  date: Date,
  venue: String,
  location: String,
  description: String,
  imageUrl: String,
  categories: [String],
  basePrice: Number,
  totalTickets: Number,
  availableTickets: Number,
  scrapeSource: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const ticketSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  previousOwners: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  section: String,
  row: String,
  seat: String,
  price: Number,
  status: { type: String, enum: ['active', 'used', 'listed', 'transferred'], default: 'active' },
  mintAddress: String,
  metadata: Object,
  transactionHistory: [{
    type: { type: String, enum: ['mint', 'purchase', 'list', 'delist', 'transfer', 'use'] },
    timestamp: { type: Date, default: Date.now },
    price: Number,
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    transactionSignature: String
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const listingSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  price: Number,
  listedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'sold', 'canceled'], default: 'active' },
  expiresAt: Date
});

// Create models
const User = mongoose.model('User', userSchema);
const Event = mongoose.model('Event', eventSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Listing = mongoose.model('Listing', listingSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Sample data
const sampleUsers = [
  {
    name: 'John Smith',
    email: 'john@example.com',
    password: 'password123',
    walletAddress: 'solana-wallet-address-1'
  },
  {
    name: 'Jane Doe',
    email: 'jane@example.com',
    password: 'password123',
    walletAddress: 'solana-wallet-address-2'
  }
];

const sampleEvents = [
  {
    title: 'Taylor Swift - The Eras Tour',
    date: new Date('2025-03-15T19:00:00'),
    venue: 'Madison Square Garden',
    location: 'New York, NY',
    description: 'Join Taylor Swift for her record-breaking Eras Tour, spanning her entire musical catalog.',
    imageUrl: 'https://placeholder.com/taylor-swift-tour.jpg',
    categories: ['Concert', 'Pop'],
    basePrice: 199,
    totalTickets: 20000,
    availableTickets: 5000,
    scrapeSource: 'manual-entry'
  },
  {
    title: 'NBA: Lakers vs. Warriors',
    date: new Date('2025-03-05T20:00:00'),
    venue: 'Staples Center',
    location: 'Los Angeles, CA',
    description: 'Watch the Lakers take on the Warriors in this exciting NBA matchup.',
    imageUrl: 'https://placeholder.com/lakers-warriors.jpg',
    categories: ['Sports', 'Basketball'],
    basePrice: 85,
    totalTickets: 18500,
    availableTickets: 2200,
    scrapeSource: 'manual-entry'
  },
  {
    title: 'Hamilton: The Musical',
    date: new Date('2025-04-10T19:30:00'),
    venue: 'Richard Rodgers Theatre',
    location: 'New York, NY',
    description: 'Experience the groundbreaking musical about Alexander Hamilton.',
    imageUrl: 'https://placeholder.com/hamilton.jpg',
    categories: ['Theater', 'Musical'],
    basePrice: 179,
    totalTickets: 1300,
    availableTickets: 200,
    scrapeSource: 'manual-entry'
  }
];

// Function to seed the database
const seedDatabase = async () => {
  try {
    // Clear existing data
    await User.deleteMany({});
    await Event.deleteMany({});
    await Ticket.deleteMany({});
    await Listing.deleteMany({});
    
    console.log('Cleared existing data');
    
    // Insert users with hashed passwords
    const insertedUsers = [];
    for (const userData of sampleUsers) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);
      
      const user = new User({
        ...userData,
        password: hashedPassword
      });
      
      await user.save();
      insertedUsers.push(user);
    }
    
    console.log(`Inserted ${insertedUsers.length} users`);
    
    // Insert events
    const insertedEvents = [];
    for (const eventData of sampleEvents) {
      const event = new Event(eventData);
      await event.save();
      insertedEvents.push(event);
    }
    
    console.log(`Inserted ${insertedEvents.length} events`);
    
    // Create some sample tickets
    const insertedTickets = [];
    
    // For each event, create some tickets
    for (const event of insertedEvents) {
      // Create tickets for the first user
      for (let i = 1; i <= 3; i++) {
        const ticket = new Ticket({
          event: event._id,
          owner: insertedUsers[0]._id,
          section: `Section ${String.fromCharCode(64 + i)}`,
          row: `${i * 5}`,
          seat: `${i * 10}`,
          price: event.basePrice,
          status: 'active',
          mintAddress: `sample-mint-address-${event._id}-${i}`,
          metadata: {
            name: `${event.title} - Ticket`,
            description: `Section ${String.fromCharCode(64 + i)}, Row ${i * 5}, Seat ${i * 10}`,
            attributes: [
              { trait_type: 'Event', value: event.title },
              { trait_type: 'Date', value: event.date.toISOString() },
              { trait_type: 'Venue', value: event.venue },
              { trait_type: 'Section', value: `Section ${String.fromCharCode(64 + i)}` },
              { trait_type: 'Row', value: `${i * 5}` },
              { trait_type: 'Seat', value: `${i * 10}` }
            ]
          },
          transactionHistory: [{
            type: 'mint',
            timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
            to: insertedUsers[0]._id,
            transactionSignature: `sample-signature-mint-${event._id}-${i}`
          }]
        });
        
        await ticket.save();
        insertedTickets.push(ticket);
      }
      
      // Create tickets for the second user
      for (let i = 1; i <= 2; i++) {
        const ticket = new Ticket({
          event: event._id,
          owner: insertedUsers[1]._id,
          section: `Section ${String.fromCharCode(67 + i)}`,
          row: `${i * 7}`,
          seat: `${i * 12}`,
          price: event.basePrice,
          status: 'active',
          mintAddress: `sample-mint-address-${event._id}-${i + 3}`,
          metadata: {
            name: `${event.title} - Ticket`,
            description: `Section ${String.fromCharCode(67 + i)}, Row ${i * 7}, Seat ${i * 12}`,
            attributes: [
              { trait_type: 'Event', value: event.title },
              { trait_type: 'Date', value: event.date.toISOString() },
              { trait_type: 'Venue', value: event.venue },
              { trait_type: 'Section', value: `Section ${String.fromCharCode(67 + i)}` },
              { trait_type: 'Row', value: `${i * 7}` },
              { trait_type: 'Seat', value: `${i * 12}` }
            ]
          },
          transactionHistory: [{
            type: 'mint',
            timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
            to: insertedUsers[1]._id,
            transactionSignature: `sample-signature-mint-${event._id}-${i + 3}`
          }]
        });
        
        await ticket.save();
        insertedTickets.push(ticket);
      }
    }
    
    console.log(`Inserted ${insertedTickets.length} tickets`);
    
    // Create sample listings for some tickets
    const insertedListings = [];
    
    // List a ticket from the first user
    const ticketToList = insertedTickets[2]; // Third ticket
    ticketToList.status = 'listed';
    await ticketToList.save();
    
    const listing = new Listing({
      ticket: ticketToList._id,
      seller: insertedUsers[0]._id,
      price: ticketToList.price * 1.5, // 50% markup
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
    });
    
    await listing.save();
    insertedListings.push(listing);
    
    console.log(`Inserted ${insertedListings.length} listings`);
    
    console.log('Database seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

// Run the seeding function
seedDatabase();