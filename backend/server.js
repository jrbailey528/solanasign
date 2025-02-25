
// server.js - Main entry point for SolanaSign backend

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { 
  Metaplex, 
  keypairIdentity, 
  bundlrStorage, 
  toMetaplexFile 
} = require('@metaplex-foundation/js');
const { createSecretKey } = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const passport = require('passport');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cheerio = require('cheerio');
const axios = require('axios');
const cron = require('node-cron');

// Load environment variables
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Configure middleware
app.use(helmet()); // Security headers
app.use(cors()); // CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(morgan('dev')); // Logging

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api', limiter);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Solana Connection
const solanaConnection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Metaplex Configuration
const metaplexConfig = () => {
  // Convert private key from .env to Uint8Array
  const privateKeyBytes = process.env.AUTHORITY_PRIVATE_KEY
    .split(',')
    .map(byte => parseInt(byte));

  const keypair = Keypair.fromSecretKey(Buffer.from(privateKeyBytes));

  return Metaplex.make(solanaConnection)
    .use(keypairIdentity(keypair))
    .use(bundlrStorage({
      address: 'https://node1.bundlr.network',
      providerUrl: process.env.SOLANA_RPC_URL,
      timeout: 60000,
    }));
};

// Models
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  walletAddress: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

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

const ticketSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  previousOwners: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  section: { type: String, required: true },
  row: { type: String, required: true },
  seat: { type: String, required: true },
  price: { type: Number, required: true },
  status: { type: String, enum: ['active', 'used', 'listed', 'transferred'], default: 'active' },
  mintAddress: { type: String }, // NFT mint address on Solana
  metadata: { type: Object }, // NFT metadata
  transactionHistory: [{
    type: { type: String, enum: ['mint', 'purchase', 'list', 'delist', 'transfer', 'use'] },
    timestamp: { type: Date, default: Date.now },
    price: { type: Number },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    transactionSignature: { type: String } // Solana transaction signature
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const listingSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  price: { type: Number, required: true },
  listedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'sold', 'canceled'], default: 'active' },
  expiresAt: { type: Date }
});

const User = mongoose.model('User', userSchema);
const Event = mongoose.model('Event', eventSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Listing = mongoose.model('Listing', listingSchema);

// Passport JWT Configuration
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
};

passport.use(new JwtStrategy(jwtOptions, async (payload, done) => {
  try {
    const user = await User.findById(payload.id);
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (error) {
    return done(error, false);
  }
}));

// Initialize Passport
app.use(passport.initialize());

// Authentication Middleware
const authenticateJwt = passport.authenticate('jwt', { session: false });

// Helper Functions
const generateToken = (user) => {
  return jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
};

// Web Scraper for Events
const scrapeEvents = async () => {
  try {
    console.log('Starting event scraping...');
    
    // Example: Scraping event data from a website similar to Ticketmaster
    const response = await axios.get('https://example-ticket-site.com/events');
    const $ = cheerio.load(response.data);
    
    const events = [];
    
    $('.event-card').each((i, element) => {
      const title = $(element).find('.event-title').text().trim();
      const dateStr = $(element).find('.event-date').text().trim();
      const venue = $(element).find('.event-venue').text().trim();
      const location = $(element).find('.event-location').text().trim();
      const description = $(element).find('.event-description').text().trim();
      const imageUrl = $(element).find('.event-image').attr('src');
      const priceText = $(element).find('.event-price').text().trim();
      const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      
      // Extract categories
      const categories = [];
      $(element).find('.event-category').each((i, catElement) => {
        categories.push($(catElement).text().trim());
      });
      
      // Parse date
      const date = new Date(dateStr);
      
      events.push({
        title,
        date,
        venue,
        location,
        description,
        imageUrl,
        categories,
        basePrice: price,
        totalTickets: Math.floor(Math.random() * 1000) + 500, // Random number for simulation
        availableTickets: Math.floor(Math.random() * 500) + 200, // Random number for simulation
        scrapeSource: 'example-ticket-site'
      });
    });
    
    console.log(`Scraped ${events.length} events`);
    
    // Save scraped events to database
    for (const eventData of events) {
      const existingEvent = await Event.findOne({ 
        title: eventData.title,
        venue: eventData.venue,
        date: eventData.date
      });
      
      if (!existingEvent) {
        const newEvent = new Event(eventData);
        await newEvent.save();
        console.log(`Saved new event: ${eventData.title}`);
      } else {
        console.log(`Event already exists: ${eventData.title}`);
      }
    }
    
    console.log('Event scraping completed successfully');
  } catch (error) {
    console.error('Error scraping events:', error);
  }
};

// Schedule event scraping to run periodically
cron.schedule('0 */12 * * *', () => {
  scrapeEvents();
});

// Mint NFT ticket function
const mintNFTTicket = async (ticket, user) => {
  try {
    const metaplex = metaplexConfig();
    const event = await Event.findById(ticket.event);
    
    if (!event) {
      throw new Error('Event not found');
    }
    
    // Prepare metadata for the NFT
    const metadata = {
      name: `${event.title} - Ticket`,
      description: `Section: ${ticket.section}, Row: ${ticket.row}, Seat: ${ticket.seat}`,
      image: event.imageUrl,
      attributes: [
        { trait_type: 'Event', value: event.title },
        { trait_type: 'Date', value: event.date.toISOString() },
        { trait_type: 'Venue', value: event.venue },
        { trait_type: 'Section', value: ticket.section },
        { trait_type: 'Row', value: ticket.row },
        { trait_type: 'Seat', value: ticket.seat },
        { trait_type: 'Ticket ID', value: ticket._id.toString() }
      ],
      properties: {
        category: 'ticket',
        creators: [
          {
            address: process.env.CREATOR_ADDRESS,
            share: 100
          }
        ]
      }
    };
    
    // Create NFT
    const { nft } = await metaplex.nfts().create({
      uri: await metaplex.nfts().uploadMetadata(metadata),
      name: metadata.name,
      sellerFeeBasisPoints: 500, // 5% royalty on secondary sales
      maxSupply: 1, // Non-fungible (unique) token
    });
    
    // Update ticket with NFT information
    ticket.mintAddress = nft.address.toString();
    ticket.metadata = metadata;
    ticket.transactionHistory.push({
      type: 'mint',
      timestamp: new Date(),
      from: null,
      to: user._id,
      transactionSignature: nft.mintAddress.toString()
    });
    
    await ticket.save();
    
    return {
      success: true,
      mintAddress: nft.address.toString(),
      metadata
    };
  } catch (error) {
    console.error('Error minting NFT ticket:', error);
    throw error;
  }
};

// Verify ticket ownership on Solana
const verifyTicketOwnership = async (mintAddress, walletAddress) => {
  try {
    const metaplex = metaplexConfig();
    const nft = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(mintAddress) });
    
    if (!nft) {
      throw new Error('NFT not found');
    }
    
    // Check if the NFT is owned by the wallet
    const isOwner = nft.token && nft.token.ownerAddress.toString() === walletAddress;
    
    return {
      success: true,
      isOwner,
      nft
    };
  } catch (error) {
    console.error('Error verifying ticket ownership:', error);
    throw error;
  }
};

// Routes
// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const newUser = new User({
      name,
      email,
      password: hashedPassword
    });
    
    await newUser.save();
    
    // Generate JWT token
    const token = generateToken(newUser);
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = generateToken(user);
    
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Event Routes
app.get('/api/events', async (req, res) => {
  try {
    const { category, venue, date, query } = req.query;
    const filter = {};
    
    if (category) {
      filter.categories = category;
    }
    
    if (venue) {
      filter.venue = { $regex: venue, $options: 'i' };
    }
    
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }
    
    if (query) {
      filter.$or = [
        { title: { $regex: query, $options: 'i' } },
        { venue: { $regex: query, $options: 'i' } },
        { location: { $regex: query, $options: 'i' } }
      ];
    }
    
    const events = await Event.find(filter).sort({ date: 1 });
    res.status(200).json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Server error fetching events' });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    res.status(200).json({ event });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ message: 'Server error fetching event' });
  }
});

// Ticket Routes
app.post('/api/tickets/purchase', authenticateJwt, async (req, res) => {
  try {
    const { eventId, section, row, seat, price } = req.body;
    
    // Validate event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    // Check ticket availability
    if (event.availableTickets <= 0) {
      return res.status(400).json({ message: 'No tickets available for this event' });
    }
    
    // Create new ticket
    const newTicket = new Ticket({
      event: eventId,
      owner: req.user._id,
      section,
      row,
      seat,
      price,
      status: 'active'
    });
    
    // Mint NFT ticket
    const nftResult = await mintNFTTicket(newTicket, req.user);
    
    // Update event available tickets
    event.availableTickets -= 1;
    await event.save();
    
    await newTicket.save();
    
    res.status(201).json({
      message: 'Ticket purchased successfully',
      ticket: newTicket,
      nft: nftResult
    });
  } catch (error) {
    console.error('Error purchasing ticket:', error);
    res.status(500).json({ message: 'Server error purchasing ticket' });
  }
});

app.get('/api/tickets/my-tickets', authenticateJwt, async (req, res) => {
  try {
    const tickets = await Ticket.find({ owner: req.user._id })
      .populate('event')
      .sort({ createdAt: -1 });
    
    res.status(200).json({ tickets });
  } catch (error) {
    console.error('Error fetching user tickets:', error);
    res.status(500).json({ message: 'Server error fetching tickets' });
  }
});

app.post('/api/tickets/:id/list', authenticateJwt, async (req, res) => {
  try {
    const { price, expiresAt } = req.body;
    const ticketId = req.params.id;
    
    // Validate ticket and ownership
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    if (ticket.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not own this ticket' });
    }
    
    if (ticket.status !== 'active') {
      return res.status(400).json({ message: 'Ticket is not available for listing' });
    }
    
    // Create listing
    const newListing = new Listing({
      ticket: ticketId,
      seller: req.user._id,
      price,
      status: 'active',
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });
    
    // Update ticket status
    ticket.status = 'listed';
    await ticket.save();
    
    await newListing.save();
    
    res.status(201).json({
      message: 'Ticket listed successfully',
      listing: newListing
    });
  } catch (error) {
    console.error('Error listing ticket:', error);
    res.status(500).json({ message: 'Server error listing ticket' });
  }
});

app.get('/api/listings', async (req, res) => {
  try {
    const { eventId } = req.query;
    const filter = { status: 'active' };
    
    if (eventId) {
      const tickets = await Ticket.find({ event: eventId }).select('_id');
      filter.ticket = { $in: tickets.map(t => t._id) };
    }
    
    const listings = await Listing.find(filter)
      .populate({
        path: 'ticket',
        populate: { path: 'event' }
      })
      .populate('seller', 'name')
      .sort({ listedAt: -1 });
    
    res.status(200).json({ listings });
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({ message: 'Server error fetching listings' });
  }
});

app.post('/api/listings/:id/purchase', authenticateJwt, async (req, res) => {
  try {
    const listingId = req.params.id;
    
    // Validate listing
    const listing = await Listing.findById(listingId)
      .populate('ticket')
      .populate('seller');
    
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    
    if (listing.status !== 'active') {
      return res.status(400).json({ message: 'Listing is not active' });
    }
    
    if (listing.seller._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot purchase your own listing' });
    }
    
    // Process purchase
    const ticket = listing.ticket;
    
    // Update ticket ownership
    ticket.previousOwners.push(ticket.owner);
    ticket.owner = req.user._id;
    ticket.status = 'active';
    ticket.price = listing.price;
    
    // Add transaction to history
    ticket.transactionHistory.push({
      type: 'purchase',
      timestamp: new Date(),
      price: listing.price,
      from: listing.seller._id,
      to: req.user._id,
      transactionSignature: 'secondary-purchase' // In a real implementation, this would be a Solana transaction signature
    });
    
    // Update listing status
    listing.status = 'sold';
    
    await ticket.save();
    await listing.save();
    
    res.status(200).json({
      message: 'Ticket purchased successfully',
      ticket
    });
  } catch (error) {
    console.error('Error purchasing listing:', error);
    res.status(500).json({ message: 'Server error purchasing listing' });
  }
});

app.post('/api/tickets/:id/transfer', authenticateJwt, async (req, res) => {
  try {
    const { recipientEmail } = req.body;
    const ticketId = req.params.id;
    
    // Validate ticket and ownership
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    if (ticket.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not own this ticket' });
    }
    
    if (ticket.status !== 'active') {
      return res.status(400).json({ message: 'Ticket is not available for transfer' });
    }
    
    // Find recipient user
    const recipient = await User.findOne({ email: recipientEmail });
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient user not found' });
    }
    
    // Update ticket ownership
    ticket.previousOwners.push(ticket.owner);
    ticket.owner = recipient._id;
    ticket.status = 'transferred';
    
    // Add transaction to history
    ticket.transactionHistory.push({
      type: 'transfer',
      timestamp: new Date(),
      from: req.user._id,
      to: recipient._id,
      transactionSignature: 'transfer' // In a real implementation, this would be a Solana transaction signature
    });
    
    await ticket.save();
    
    res.status(200).json({
      message: 'Ticket transferred successfully',
      ticket
    });
  } catch (error) {
    console.error('Error transferring ticket:', error);
    res.status(500).json({ message: 'Server error transferring ticket' });
  }
});

app.post('/api/tickets/:id/verify', async (req, res) => {
  try {
    const ticketId = req.params.id;
    
    // Find ticket
    const ticket = await Ticket.findById(ticketId)
      .populate('owner')
      .populate('event');
    
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    // Verify the ticket on the blockchain if it has a mint address
    if (ticket.mintAddress) {
      const ownerWalletAddress = ticket.owner.walletAddress;
      
      if (!ownerWalletAddress) {
        return res.status(400).json({ message: 'Ticket owner does not have a wallet address' });
      }
      
      const verificationResult = await verifyTicketOwnership(ticket.mintAddress, ownerWalletAddress);
      
      if (!verificationResult.isOwner) {
        return res.status(403).json({ message: 'Ticket ownership verification failed on blockchain' });
      }
    }
    
    // Mark ticket as used
    if (ticket.status === 'active') {
      ticket.status = 'used';
      ticket.transactionHistory.push({
        type: 'use',
        timestamp: new Date(),
        from: ticket.owner._id,
        to: null
      });
      
      await ticket.save();
    }
    
    res.status(200).json({
      message: 'Ticket verified successfully',
      ticket
    });
  } catch (error) {
    console.error('Error verifying ticket:', error);
    res.status(500).json({ message: 'Server error verifying ticket' });
  }
});

// User Profile Routes
app.get('/api/user/profile', authenticateJwt, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.status(200).json({ user });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

app.put('/api/user/profile', authenticateJwt, async (req, res) => {
  try {
    const { name, email, walletAddress } = req.body;
    
    // Find user
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update user fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (walletAddress) user.walletAddress = walletAddress;
    
    user.updatedAt = new Date();
    await user.save();
    
    res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        walletAddress: user.walletAddress
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error updating profile' });
  }
});

// Transaction History Route
app.get('/api/user/transactions', authenticateJwt, async (req, res) => {
  try {
    // Find all tickets owned by user (current and past)
    const userTickets = await Ticket.find({
      $or: [
        { owner: req.user._id },
        { previousOwners: req.user._id }
      ]
    }).select('_id');
    
    // Find all transactions for these tickets
    const tickets = await Ticket.find({
      _id: { $in: userTickets.map(t => t._id) }
    })
    .populate('event', 'title date venue')
    .populate('transactionHistory.from', 'name')
    .populate('transactionHistory.to', 'name');
    
    // Extract and flatten all transactions
    const transactions = [];
    
    tickets.forEach(ticket => {
      ticket.transactionHistory.forEach(transaction => {
        // Only include transactions where the user was involved
        if ((transaction.from && transaction.from._id.toString() === req.user._id.toString()) ||
            (transaction.to && transaction.to._id.toString() === req.user._id.toString())) {
          transactions.push({
            id: transaction._id,
            type: transaction.type,
            timestamp: transaction.timestamp,
            price: transaction.price,
            from: transaction.from,
            to: transaction.to,
            event: ticket.event,
            ticket: {
              id: ticket._id,
              section: ticket.section,
              row: ticket.row,
              seat: ticket.seat
            }
          });
        }
      });
    });
    
    // Sort transactions by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);
    
    res.status(200).json({ transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Server error fetching transactions' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Run initial scraping at startup
  scrapeEvents();
});

module.exports = app;