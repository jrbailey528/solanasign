// File: models/Event.js
// Enhanced Event model to match the ticket data structure

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: Date, required: true },
  venue: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String },
  categories: [{ type: String }],
  basePrice: { type: Number, required: true },
  premiumPrice: { type: Number },
  vipPrice: { type: Number },
  totalTickets: { type: Number, required: true },
  availableTickets: { type: Number, required: true },
  soldTickets: { type: Number, default: 0 },
  percentSold: { type: Number },
  status: { type: String, enum: ['On Sale', 'Sold Out', 'Postponed', 'Canceled', 'Rescheduled'], default: 'On Sale' },
  scrapeSource: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Pre-save hook to calculate percentSold if not provided
eventSchema.pre('save', function(next) {
  if (this.totalTickets > 0) {
    this.percentSold = (this.soldTickets / this.totalTickets) * 100;
  }
  next();
});

const Event = mongoose.model('Event', eventSchema);

module.exports = Event;