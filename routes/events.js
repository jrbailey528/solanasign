// File: routes/events.js
// Enhanced routes for the events API

const express = require('express');
const router = express.Router();
const Event = require('../models/Event');

// Get all events with filtering
router.get('/', async (req, res) => {
  try {
    const { 
      category, 
      venue, 
      location, 
      date, 
      priceMin, 
      priceMax, 
      status,
      sort = 'date', // Default sort by date
      limit = 20      // Default limit
    } = req.query;
    
    // Build filter object
    const filter = {};
    
    if (category) {
      filter.categories = { $in: [category] };
    }
    
    if (venue) {
      filter.venue = { $regex: venue, $options: 'i' };
    }
    
    if (location) {
      filter.location = { $regex: location, $options: 'i' };
    }
    
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }
    
    if (priceMin || priceMax) {
      filter.basePrice = {};
      if (priceMin) filter.basePrice.$gte = Number(priceMin);
      if (priceMax) filter.basePrice.$lte = Number(priceMax);
    }
    
    if (status) {
      filter.status = status;
    }
    
    // Build sort object
    let sortObj = {};
    if (sort === 'price-asc') {
      sortObj.basePrice = 1;
    } else if (sort === 'price-desc') {
      sortObj.basePrice = -1;
    } else if (sort === 'popularity') {
      sortObj.percentSold = -1;
    } else {
      // Default: sort by date
      sortObj.date = 1;
    }
    
    // Execute query
    const events = await Event.find(filter)
      .sort(sortObj)
      .limit(Number(limit));
    
    res.status(200).json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Server error fetching events' });
  }
});

// Get event by ID
router.get('/:id', async (req, res) => {
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

// Get event categories with counts
router.get('/categories/all', async (req, res) => {
  try {
    // Use aggregation to get unique categories with counts
    const categories = await Event.aggregate([
      { $unwind: "$categories" },
      { $group: { _id: "$categories", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    res.status(200).json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Server error fetching categories' });
  }
});

// Get venue list with event counts
router.get('/venues/all', async (req, res) => {
  try {
    const venues = await Event.aggregate([
      { $group: { _id: "$venue", location: { $first: "$location" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    res.status(200).json({ venues });
  } catch (error) {
    console.error('Error fetching venues:', error);
    res.status(500).json({ message: 'Server error fetching venues' });
  }
});

module.exports = router;