import { Room, POSItem, ShiftReport, ExpenseItem, UserAccount, BillableService } from './types';

// Helper function to generate clean room templates
const createRoom = (
  number: string,
  tier: 'Suite' | 'Deluxe' | 'Standard',
  floor: number,
  roomType: string
): Room => ({
  number,
  state: 'available',
  time: 'READY',
  label: 'Available',
  tier,
  floor,
  roomType,
  guestName: '',
  guestId: '',
  numGuests: 0,
  rateSelected: '24h',
  extraBeds: 0,
  towelSets: 0
});

export const INITIAL_ROOMS: Room[] = [
  // VIP Suites (Floor 1: Rooms 1-5)
  createRoom('1', 'Suite', 1, 'VIP Suite'),
  createRoom('2', 'Suite', 1, 'VIP Suite'),
  createRoom('3', 'Suite', 1, 'VIP Suite'),
  createRoom('4', 'Suite', 1, 'VIP Suite'),
  createRoom('5', 'Suite', 1, 'VIP Suite'),

  // Classic Rooms (Floor 1: Rooms 6-11)
  createRoom('6', 'Standard', 1, 'Classic Room'),
  createRoom('7', 'Standard', 1, 'Classic Room'),
  createRoom('8', 'Standard', 1, 'Classic Room'),
  createRoom('9', 'Standard', 1, 'Classic Room'),
  createRoom('10', 'Standard', 1, 'Classic Room'),
  createRoom('11', 'Standard', 1, 'Classic Room'),

  // Staff House (Floor 2: Room 12 - Permanent Employee Quarters)
  {
    number: '12',
    state: 'occupied',
    time: 'STAFF',
    label: 'Staff House',
    tier: 'Standard',
    floor: 2,
    roomType: 'Staff House',
    guestName: 'Sedona Staff',
    guestId: 'STAFF',
    numGuests: 0,
    rateSelected: '24h',
    extraBeds: 0,
    towelSets: 0,
    isStaffHouse: true,
  },

  // Premium Rooms (Floor 2: Rooms 13-26)
  createRoom('13', 'Deluxe', 2, 'Premium Room'),
  createRoom('14', 'Deluxe', 2, 'Premium Room'),
  createRoom('15', 'Deluxe', 2, 'Premium Room'),
  createRoom('16', 'Deluxe', 2, 'Premium Room'),
  createRoom('17', 'Deluxe', 2, 'Premium Room'),
  createRoom('18', 'Deluxe', 2, 'Premium Room'),
  createRoom('19', 'Deluxe', 2, 'Premium Room'),
  createRoom('20', 'Deluxe', 2, 'Premium Room'),
  createRoom('21', 'Deluxe', 2, 'Premium Room'),
  createRoom('22', 'Deluxe', 2, 'Premium Room'),
  createRoom('23', 'Deluxe', 2, 'Premium Room'),
  createRoom('24', 'Deluxe', 2, 'Premium Room'),
  createRoom('25', 'Deluxe', 2, 'Premium Room'),
  createRoom('26', 'Deluxe', 2, 'Premium Room'),

  // Classic Rooms (Floor 3: Rooms 27-32)
  createRoom('27', 'Standard', 3, 'Classic Room'),
  createRoom('28', 'Standard', 3, 'Classic Room'),
  createRoom('29', 'Standard', 3, 'Classic Room'),
  createRoom('30', 'Standard', 3, 'Classic Room'),
  createRoom('31', 'Standard', 3, 'Classic Room'),
  createRoom('32', 'Standard', 3, 'Classic Room'),
];

export const POS_CATALOG: POSItem[] = [
  // --- ALL DAY BREAKFAST ---
  {
    id: 'bf-bangsilog',
    name: 'Bangsilog',
    price: 150,
    category: 'Breakfast',
    description: 'Pan-fried marinated milkfish (bangus), garlic sinangag rice, and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-porksilog',
    name: 'Porksilog',
    price: 150,
    category: 'Breakfast',
    description: 'Golden crispy pork chop, garlic fried rice, and sunny-side-up egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-chicksilog',
    name: 'Chicksilog',
    price: 150,
    category: 'Breakfast',
    description: 'Crisp seasoned fried chicken, fragrant garlic rice, and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-tapsilog',
    name: 'Tapsilog',
    price: 160,
    category: 'Breakfast',
    description: 'Tender marinated beef tapa, garlic sinangag, and farm-fresh fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-longsilog',
    name: 'Longsilog',
    price: 150,
    category: 'Breakfast',
    description: 'Savory-sweet native longganisa sausages, garlic sinangag rice, and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-hotsilog',
    name: 'Hotsilog',
    price: 130,
    category: 'Breakfast',
    description: 'Juicy red hotdogs with fragrant garlic fried rice and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- ALL TIME FAVORITES ---
  {
    id: 'fav-calamares',
    name: 'Calamares',
    price: 180,
    category: 'Favorites',
    description: 'Crisp golden battered squid rings served with tartar dipping sauce.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-lechon-kawali',
    name: 'Lechon Kawali',
    price: 230,
    category: 'Favorites',
    description: 'Crispy deep-fried pork belly chunks served with spiced liver sauce.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-chicharong-bulaklak',
    name: 'Chicharong Bulaklak',
    price: 200,
    category: 'Favorites',
    description: 'Crunchy deep-fried pork ruffle fat served with seasoned spicy cane vinegar.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-buffalo-wings',
    name: 'Buffalo Wings',
    price: 230,
    category: 'Favorites',
    description: 'Crispy chicken wings tossed in rich, zesty buffalo glaze.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-buttered-chicken',
    name: 'Buttered Chicken*',
    price: 230,
    category: 'Favorites',
    description: 'Tender chicken bites sautéed in rich garlic butter sauce (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-garlic-chicken',
    name: 'Garlic Chicken*',
    price: 230,
    category: 'Favorites',
    description: 'Crisp seasoned chicken smothered in aromatic toasted garlic bits (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-tokwat-baboy',
    name: "Tokwa't Baboy*",
    price: 140,
    category: 'Favorites',
    description: 'Deep-fried firm tofu and tender pork slices in seasoned soy-vinegar dressing (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-sizzling-tofu',
    name: 'Sizzling Tofu*',
    price: 140,
    category: 'Favorites',
    description: 'Crispy tofu cubes tossed with savory creamy dressing on a sizzling plate (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-sizzling-sisig-egg',
    name: 'Sizzling Sisig with Egg*',
    price: 230,
    category: 'Favorites',
    description: 'Crispy seasoned minced pork sisig with onions, chili, and fresh egg on hot plate (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-sizzling-hotdog',
    name: 'Sizzling Hotdog*',
    price: 150,
    category: 'Favorites',
    description: 'Sliced tender hotdogs sautéed with onions in savory sweet gravy (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-pancit-canton',
    name: 'Pancit Canton',
    price: 130,
    category: 'Favorites',
    description: 'Stir-fried egg noodles with crisp vegetables, pork slices, and savory sauce.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-lomi',
    name: 'Lomi',
    price: 130,
    category: 'Favorites',
    description: 'Thick egg noodle soup with rich savory broth, egg drops, and hearty meat toppings.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-french-fries',
    name: 'French Fries',
    price: 90,
    category: 'Favorites',
    description: 'Golden crispy shoestring potato fries with ketchup or mayo dip.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- KITCHEN EXTRAS ---
  {
    id: 'ext-plain-rice',
    name: 'Plain Rice',
    price: 30,
    category: 'Kitchen Extras',
    description: 'Steamed fragrant white jasmine rice.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-garlic-rice',
    name: 'Garlic Rice',
    price: 40,
    category: 'Kitchen Extras',
    description: 'Sinangag rice sautéed with toasted garlic chips.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-egg',
    name: 'Egg (Fried/Boiled)',
    price: 20,
    category: 'Kitchen Extras',
    description: 'Farm fresh egg cooked to preference (sunny side up, scrambled, or hard-boiled).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-ice-bucket',
    name: 'Ice Bucket',
    price: 30,
    category: 'Kitchen Extras',
    description: 'Full bucket of clean tube ice with stainless tongs.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-hot-water',
    name: 'Hot Water',
    price: 20,
    category: 'Kitchen Extras',
    description: 'Thermos carafe of boiling hot water for tea, coffee, or instant meals.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- DRINKS (Available 24/7) ---
  {
    id: 'drk-coke',
    name: 'Coke',
    price: 60,
    category: 'Drinks',
    description: 'Chilled canned Coca-Cola regular 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-coke-zero',
    name: 'Coke Zero',
    price: 60,
    category: 'Drinks',
    description: 'Chilled canned Coca-Cola Zero Sugar 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-sprite',
    name: 'Sprite',
    price: 60,
    category: 'Drinks',
    description: 'Chilled canned Sprite lemon-lime soda 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-royal',
    name: 'Royal',
    price: 60,
    category: 'Drinks',
    description: 'Chilled canned Royal Tru-Orange soda 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-pineapple-juice',
    name: 'Pineapple Juice',
    price: 60,
    category: 'Drinks',
    description: 'Chilled Del Monte 100% pure pineapple juice in can.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-c2-apple',
    name: 'C2 Apple',
    price: 60,
    category: 'Drinks',
    description: 'C2 Cool & Clean bottled green tea apple flavor 500ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-mineral-water',
    name: 'Mineral Water',
    price: 25,
    category: 'Drinks',
    description: 'Purified bottled drinking water 500ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-coffee',
    name: 'Coffee (Brown/Blanca)',
    price: 25,
    category: 'Drinks',
    description: 'Nescafe / Kopiko 3-in-1 coffee sachet with hot cup and water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-milo',
    name: 'Milo',
    price: 25,
    category: 'Drinks',
    description: 'Nestle Milo chocolate malt energy drink with hot cup and water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-san-miguel-beer',
    name: 'San Miguel Beer',
    price: 90,
    category: 'Drinks',
    description: 'San Miguel Pale Pilsen 330ml bottle, ice-cold.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-san-mig-light',
    name: 'San Mig Light',
    price: 90,
    category: 'Drinks',
    description: 'San Mig Light low-calorie beer 330ml bottle, ice-cold.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-redhorse',
    name: 'Redhorse',
    price: 90,
    category: 'Drinks',
    description: 'Red Horse Extra Strong Beer 330ml bottle, ice-cold.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- MISCELLANEOUS (Available 24/7) ---
  {
    id: 'misc-cupnoodles-beef',
    name: 'Cup Noodles (Beef)',
    price: 60,
    category: 'Miscellaneous',
    description: 'Nissin Cup Noodles Beef flavor with hot water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-cupnoodles-bulalo',
    name: 'Cup Noodles (Bulalo)',
    price: 60,
    category: 'Miscellaneous',
    description: 'Nissin Cup Noodles Bulalo flavor with hot water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-cupnoodles-seafood',
    name: 'Cup Noodles (Seafood)',
    price: 60,
    category: 'Miscellaneous',
    description: 'Nissin Cup Noodles Seafood flavor with hot water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-piatos',
    name: 'Piatos',
    price: 45,
    category: 'Miscellaneous',
    description: 'Jack & Jill Piattos potato chips snack pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-nova',
    name: 'Nova',
    price: 45,
    category: 'Miscellaneous',
    description: 'Nova multigrain snack chips pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-pica',
    name: 'Pic-A',
    price: 45,
    category: 'Miscellaneous',
    description: 'Pic-A assorted snack mix pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-vcut',
    name: 'V-Cut',
    price: 45,
    category: 'Miscellaneous',
    description: 'Jack & Jill V-Cut ridged potato chips snack pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-candy',
    name: 'Halls / Snowbear Candy*',
    price: 20,
    category: 'Miscellaneous',
    description: 'Menthol soothing candy pack (Halls or Snowbear).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-marlboro-red',
    name: 'Marlboro Red',
    price: 235,
    category: 'Miscellaneous',
    description: 'Marlboro Red cigarette pack (20 sticks).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-marlboro-lights',
    name: 'Marlboro Lights',
    price: 235,
    category: 'Miscellaneous',
    description: 'Marlboro Lights / Gold cigarette pack (20 sticks).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-lighter',
    name: 'Lighter',
    price: 35,
    category: 'Miscellaneous',
    description: 'Disposable gas lighter.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-condom',
    name: 'Condom',
    price: 65,
    category: 'Miscellaneous',
    description: 'Lubricated premium latex condom (pack of 3).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-sanitary-napkin',
    name: 'Sanitary Napkin',
    price: 25,
    category: 'Miscellaneous',
    description: 'Feminine sanitary pads with wings.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-pantiliner',
    name: 'Pantiliner',
    price: 20,
    category: 'Miscellaneous',
    description: 'Breathable daily pantiliners pack.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-feminine-wash',
    name: 'Feminine Wash',
    price: 25,
    category: 'Miscellaneous',
    description: 'Gentle intimate cleansing wash travel sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-tissue-roll',
    name: 'Tissue Roll',
    price: 25,
    category: 'Miscellaneous',
    description: 'Soft 2-ply bathroom tissue roll.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-shaving-kit',
    name: 'Shaving Kit',
    price: 25,
    category: 'Miscellaneous',
    description: 'Twin-blade disposable razor with shaving cream.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-soap-safeguard',
    name: 'Soap (Safeguard)',
    price: 35,
    category: 'Miscellaneous',
    description: 'Safeguard antibacterial white bar soap 60g.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-shampoo',
    name: 'Shampoo',
    price: 25,
    category: 'Miscellaneous',
    description: 'Revitalizing hair shampoo sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-conditioner',
    name: 'Conditioner',
    price: 25,
    category: 'Miscellaneous',
    description: 'Moisturizing hair conditioner sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-toothpaste-sachet',
    name: 'Toothpaste Sachet',
    price: 30,
    category: 'Miscellaneous',
    description: 'Colgate travel toothpaste sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-toothbrush',
    name: 'Toothbrush',
    price: 40,
    category: 'Miscellaneous',
    description: 'Medium-soft sealed travel manual toothbrush.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- ROOM & BEDDING EXTRAS ---
  {
    id: 'extra-person',
    name: 'Extra Person',
    price: 150,
    category: 'Extras',
    description: 'Additional guest charge per night',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'extra-bed',
    name: 'Extra Bed',
    price: 250,
    category: 'Extras',
    description: 'Rollaway single mattress set',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bed-sheet',
    name: 'Bed sheet',
    price: 150,
    category: 'Extras',
    description: 'Fresh clean single/double bedsheet',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'extra-bedsheet-set',
    name: 'Extra Bed (set)',
    price: 500,
    category: 'Extras',
    description: 'Complete linen set (sheet, blanket, pillows)',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'pillow',
    name: 'Pillow',
    price: 200,
    category: 'Extras',
    description: 'Extra fluffy head pillow',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'pillow-case',
    name: 'Pillow case',
    price: 100,
    category: 'Extras',
    description: 'Fresh replacement pillow protector',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'blanket',
    name: 'Blanket',
    price: 100,
    category: 'Extras',
    description: 'Cozy warm thermal blanket',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'towel',
    name: 'Towel',
    price: 100,
    category: 'Extras',
    description: 'Plush high-absorbency bath towel',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'supply-guest-kit',
    name: 'Guest Kit',
    price: 50,
    category: 'Extras',
    description: 'Complete guest amenity kit (hygiene, toiletries).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'supply-beddings',
    name: 'Beddings Set',
    price: 200,
    category: 'Extras',
    description: 'Complete fresh beddings linen pack.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'laundry-regular',
    name: 'Regular Laundry (Per kg)',
    price: 120,
    category: 'Laundry',
    description: 'Wash, dry, and fold service. Next day delivery.',
    imageUrl: 'https://placehold.co/400x300'
  }
];

export const EXPENSES_COLUMN_1: ExpenseItem[] = [
  { name: 'kitchen', amount: 5193.00 },
  { name: 'wilkins pure', amount: 2200.00 },
  { name: 'ate lanie beddings', amount: 12000.00 },
  { name: 'k.rico gas new laundry', amount: 298.00 },
  { name: 'tissue flexi cling', amount: 5200.00 },
  { name: 'miscellaneous', amount: 2090.00 },
  { name: 'kovi', amount: 6204.00 },
  { name: 'CM SURC rh', amount: 5925.00 },
  { name: 'LIEMPO', amount: 5718.00 },
  { name: 'marbont', amount: 7100.00 },
  { name: 'aquapura', amount: 300.00 },
  { name: 'andeng store', amount: 2334.00 },
  { name: 'george cable', amount: 3410.00 },
  { name: 'rn meat', amount: 2055.00 },
  { name: 'kovi', amount: 6104.00 },
  { name: 'coke zero', amount: 1556.00 },
  { name: 'short pau', amount: 130.00 },
  { name: 'yenyen zonrox', amount: 5095.00 },
  { name: 'Kitchen Subtotal', amount: 73312.00, isSubtotal: true }
];

export const EXPENSES_COLUMN_2: ExpenseItem[] = [
  { name: 'kitchen', amount: 2792.00 },
  { name: 'vale pau cam id', amount: 8000.00 },
  { name: 'admin gretch sa', amount: 70000.00 },
  { name: 'TOTAL EXPENSES', amount: 154104.00, isSubtotal: true }
];

export const WEEKLY_SHIFT_REPORTS: ShiftReport[] = [
  {
    date: 'Jun 15',
    dayOfWeek: 'MON',
    shift: 'DAY',
    cashier: 'PAU',
    checkins: 55,
    out: 46,
    transf: 18,
    roomBill: 29010.00,
    kitchen: 850.00,
    drinks: 370.00,
    miscell: 260.00,
    extras: 0,
    disc: 0,
    received: 30490.00
  },
  {
    date: 'Jun 15',
    dayOfWeek: 'MON',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 33,
    out: 44,
    transf: 7,
    roomBill: 22555.00,
    kitchen: 470.00,
    drinks: 1240.00,
    miscell: 770.00,
    extras: 150.00,
    disc: 170.00,
    received: 25015.00
  },
  {
    date: 'Jun 16',
    dayOfWeek: 'TUE',
    shift: 'DAY',
    cashier: 'ANN',
    checkins: 48,
    out: 38,
    transf: 17,
    roomBill: 22625.00,
    kitchen: 1070.00,
    drinks: 785.00,
    miscell: 570.00,
    extras: 500.00,
    disc: 50.00,
    received: 25500.00
  },
  {
    date: 'Jun 16',
    dayOfWeek: 'TUE',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 31,
    out: 42,
    transf: 6,
    roomBill: 23040.00,
    kitchen: 1300.00,
    drinks: 1420.00,
    miscell: 345.00,
    extras: 400.00,
    disc: 130.00,
    received: 26375.00
  },
  {
    date: 'Jun 17',
    dayOfWeek: 'WED',
    shift: 'DAY',
    cashier: 'ANN',
    checkins: 39,
    out: 28,
    transf: 17,
    roomBill: 19560.00,
    kitchen: 860.00,
    drinks: 345.00,
    miscell: 140.00,
    extras: 0,
    disc: 120.00,
    received: 20785.00
  },
  {
    date: 'Jun 17',
    dayOfWeek: 'WED',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 35,
    out: 43,
    transf: 9,
    roomBill: 18310.00,
    kitchen: 1840.00,
    drinks: 2110.00,
    miscell: 365.00,
    extras: 0,
    disc: 40.00,
    received: 22585.00
  },
  {
    date: 'Jun 18',
    dayOfWeek: 'THU',
    shift: 'DAY',
    cashier: 'ANN',
    checkins: 40,
    out: 32,
    transf: 17,
    roomBill: 19295.00,
    kitchen: 260.00,
    drinks: 585.00,
    miscell: 115.00,
    extras: 0,
    disc: 50.00,
    received: 20205.00
  },
  {
    date: 'Jun 18',
    dayOfWeek: 'THU',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 31,
    out: 46,
    transf: 2,
    roomBill: 22960.00,
    kitchen: 320.00,
    drinks: 690.00,
    miscell: 120.00,
    extras: 0,
    disc: 40.00,
    received: 24050.00
  },
  {
    date: 'Jun 19',
    dayOfWeek: 'FRI',
    shift: 'DAY',
    cashier: 'ANN',
    checkins: 41,
    out: 28,
    transf: 45,
    roomBill: 14865.00,
    kitchen: 1010.00,
    drinks: 390.00,
    miscell: 175.00,
    extras: 0,
    disc: 40.00,
    received: 16400.00
  },
  {
    date: 'Jun 19',
    dayOfWeek: 'FRI',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 51,
    out: 45,
    transf: 21,
    roomBill: 23365.00,
    kitchen: 1570.00,
    drinks: 1335.00,
    miscell: 255.00,
    extras: 0,
    disc: 80.00,
    received: 26445.00
  },
  {
    date: 'Jun 20',
    dayOfWeek: 'SAT',
    shift: 'DAY',
    cashier: 'ANN',
    checkins: 48,
    out: 49,
    transf: 20,
    roomBill: 33120.00,
    kitchen: 590.00,
    drinks: 1275.00,
    miscell: 0,
    extras: 0,
    disc: 130.00,
    received: 34855.00
  },
  {
    date: 'Jun 20',
    dayOfWeek: 'SAT',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 52,
    out: 50,
    transf: 22,
    roomBill: 26565.00,
    kitchen: 890.00,
    drinks: 790.00,
    miscell: 295.00,
    extras: 0,
    disc: 80.00,
    received: 28460.00
  },
  {
    date: 'Jun 21',
    dayOfWeek: 'SUN',
    shift: 'DAY',
    cashier: 'ANN',
    checkins: 46,
    out: 49,
    transf: 19,
    roomBill: 35285.00,
    kitchen: 1560.00,
    drinks: 1450.00,
    miscell: 390.00,
    extras: 0,
    disc: 60.00,
    received: 38625.00
  },
  {
    date: 'Jun 21',
    dayOfWeek: 'SUN',
    shift: 'NIGHT',
    cashier: 'RCA',
    checkins: 41,
    out: 55,
    transf: 5,
    roomBill: 30745.00,
    kitchen: 1870.00,
    drinks: 2170.00,
    miscell: 435.00,
    extras: 150.00,
    disc: 0,
    received: 35370.00
  }
];

// NOTE: Access codes are intentionally excluded from this frontend-facing array.
// They are defined server-side only in server/data/seed-accounts.ts for DB seeding.
// The frontend only needs username/name/role for display.
export const USER_ACCOUNTS: UserAccount[] = [
  // 1 Kitchen account
  { username: 'kitchen1', name: 'SCTI Kitchen Staff', role: 'kitchen' },
  // Cashier accounts
  { username: 'pau', name: 'Pau (Cashier)', role: 'cashier' },
  { username: 'raquel', name: 'Raquel (Cashier)', role: 'cashier' },
  { username: 'tuter', name: 'Tuter (Cashier)', role: 'cashier' },
  // Compatibility test cashier
  { username: 'ann', name: 'Ann (Cashier)', role: 'cashier' },
  // 2 Admin accounts
  { username: 'admin1', name: 'Alex (Admin 1)', role: 'admin' },
  { username: 'admin2', name: 'Chris (Admin 2)', role: 'admin' },
  // compatibility admin
  { username: 'admin', name: 'Admin Terminal', role: 'admin' },
  // 1 Owner account
  { username: 'owner', name: 'Sedona Owner', role: 'owner' }
];

export const DEFAULT_BILLABLE_SERVICES: BillableService[] = [
  // --- ROOM RATES ---
  // Standard Room Rates (Classic Room)
  {
    id: 'rate-standard-3h',
    type: 'room_rate',
    name: 'Classic Room Stay (3 Hours)',
    price: 395,
    category: 'Standard',
    active: true,
    rateType: '3h',
    description: '3 hours short-stay block for Classic Rooms'
  },
  {
    id: 'rate-standard-6h',
    type: 'room_rate',
    name: 'Classic Room Stay (6 Hours)',
    price: 790,
    category: 'Standard',
    active: false,
    rateType: '6h',
    description: '6 hours short-stay block for Classic Rooms'
  },
  {
    id: 'rate-standard-12h',
    type: 'room_rate',
    name: 'Classic Room Stay (12 Hours)',
    price: 1195,
    category: 'Standard',
    active: true,
    rateType: '12h',
    description: '12 hours half-day block for Classic Rooms'
  },
  {
    id: 'rate-standard-24h',
    type: 'room_rate',
    name: 'Classic Room Stay (24 Hours)',
    price: 2100,
    category: 'Standard',
    active: true,
    rateType: '24h',
    description: '24 hours full-day block for Classic Rooms'
  },
  {
    id: 'rate-standard-promo',
    type: 'room_rate',
    name: 'Classic Room Midnight Promo (8pm - 6am)',
    price: 995,
    category: 'Standard',
    active: true,
    rateType: 'promo',
    description: 'Midnight Promo: strictly 8pm check-in to 6am check-out for Classic Rooms'
  },

  // Deluxe Room Rates (Premium Room)
  {
    id: 'rate-deluxe-3h',
    type: 'room_rate',
    name: 'Premium Room Stay (3 Hours)',
    price: 495,
    category: 'Deluxe',
    active: true,
    rateType: '3h',
    description: '3 hours short-stay block for Premium Rooms'
  },
  {
    id: 'rate-deluxe-6h',
    type: 'room_rate',
    name: 'Premium Room Stay (6 Hours)',
    price: 890,
    category: 'Deluxe',
    active: false,
    rateType: '6h',
    description: '6 hours short-stay block for Premium Rooms'
  },
  {
    id: 'rate-deluxe-12h',
    type: 'room_rate',
    name: 'Premium Room Stay (12 Hours)',
    price: 1295,
    category: 'Deluxe',
    active: true,
    rateType: '12h',
    description: '12 hours half-day block for Premium Rooms'
  },
  {
    id: 'rate-deluxe-24h',
    type: 'room_rate',
    name: 'Premium Room Stay (24 Hours)',
    price: 2300,
    category: 'Deluxe',
    active: true,
    rateType: '24h',
    description: '24 hours full-day block for Premium Rooms'
  },
  {
    id: 'rate-deluxe-promo',
    type: 'room_rate',
    name: 'Premium Room Midnight Promo (8pm - 6am)',
    price: 1055,
    category: 'Deluxe',
    active: true,
    rateType: 'promo',
    description: 'Midnight Promo: strictly 8pm check-in to 6am check-out for Premium Rooms'
  },

  // Suite Room Rates (VIP Room)
  {
    id: 'rate-suite-3h',
    type: 'room_rate',
    name: 'VIP Suite Stay (3 Hours)',
    price: 695,
    category: 'Suite',
    active: true,
    rateType: '3h',
    description: '3 hours short-stay block for VIP Suite Rooms'
  },
  {
    id: 'rate-suite-6h',
    type: 'room_rate',
    name: 'VIP Suite Stay (6 Hours)',
    price: 1090,
    category: 'Suite',
    active: false,
    rateType: '6h',
    description: '6 hours short-stay block for VIP Suite Rooms'
  },
  {
    id: 'rate-suite-12h',
    type: 'room_rate',
    name: 'VIP Suite Stay (12 Hours)',
    price: 1395,
    category: 'Suite',
    active: true,
    rateType: '12h',
    description: '12 hours half-day block for VIP Suite Rooms'
  },
  {
    id: 'rate-suite-24h',
    type: 'room_rate',
    name: 'VIP Suite Stay (24 Hours)',
    price: 2500,
    category: 'Suite',
    active: true,
    rateType: '24h',
    description: '24 hours full-day block for VIP Suite Rooms'
  },
  {
    id: 'rate-suite-promo',
    type: 'room_rate',
    name: 'VIP Suite Midnight Promo (8pm - 6am)',
    price: 1155,
    category: 'Suite',
    active: true,
    rateType: 'promo',
    description: 'Midnight Promo: strictly 8pm check-in to 6am check-out for VIP Suite Rooms'
  },

  // --- ALL DAY BREAKFAST ---
  {
    id: 'bf-bangsilog',
    type: 'menu_item',
    name: 'Bangsilog',
    price: 150,
    category: 'Breakfast',
    active: true,
    description: 'Pan-fried marinated milkfish (bangus), garlic sinangag rice, and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-porksilog',
    type: 'menu_item',
    name: 'Porksilog',
    price: 150,
    category: 'Breakfast',
    active: true,
    description: 'Golden crispy pork chop, garlic fried rice, and sunny-side-up egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-chicksilog',
    type: 'menu_item',
    name: 'Chicksilog',
    price: 150,
    category: 'Breakfast',
    active: true,
    description: 'Crisp seasoned fried chicken, fragrant garlic rice, and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-tapsilog',
    type: 'menu_item',
    name: 'Tapsilog',
    price: 160,
    category: 'Breakfast',
    active: true,
    description: 'Tender marinated beef tapa, garlic sinangag, and farm-fresh fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-longsilog',
    type: 'menu_item',
    name: 'Longsilog',
    price: 150,
    category: 'Breakfast',
    active: true,
    description: 'Savory-sweet native longganisa sausages, garlic sinangag rice, and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bf-hotsilog',
    type: 'menu_item',
    name: 'Hotsilog',
    price: 130,
    category: 'Breakfast',
    active: true,
    description: 'Juicy red hotdogs with fragrant garlic fried rice and fried egg.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- ALL TIME FAVORITES ---
  {
    id: 'fav-calamares',
    type: 'menu_item',
    name: 'Calamares',
    price: 180,
    category: 'Favorites',
    active: true,
    description: 'Crisp golden battered squid rings served with tartar dipping sauce.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-lechon-kawali',
    type: 'menu_item',
    name: 'Lechon Kawali',
    price: 230,
    category: 'Favorites',
    active: true,
    description: 'Crispy deep-fried pork belly chunks served with spiced liver sauce.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-chicharong-bulaklak',
    type: 'menu_item',
    name: 'Chicharong Bulaklak',
    price: 200,
    category: 'Favorites',
    active: true,
    description: 'Crunchy deep-fried pork ruffle fat served with seasoned spicy cane vinegar.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-buffalo-wings',
    type: 'menu_item',
    name: 'Buffalo Wings',
    price: 230,
    category: 'Favorites',
    active: true,
    description: 'Crispy chicken wings tossed in rich, zesty buffalo glaze.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-buttered-chicken',
    type: 'menu_item',
    name: 'Buttered Chicken*',
    price: 230,
    category: 'Favorites',
    active: true,
    description: 'Tender chicken bites sautéed in rich garlic butter sauce (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-garlic-chicken',
    type: 'menu_item',
    name: 'Garlic Chicken*',
    price: 230,
    category: 'Favorites',
    active: true,
    description: 'Crisp seasoned chicken smothered in aromatic toasted garlic bits (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-tokwat-baboy',
    type: 'menu_item',
    name: "Tokwa't Baboy*",
    price: 140,
    category: 'Favorites',
    active: true,
    description: 'Deep-fried firm tofu and tender pork slices in seasoned soy-vinegar dressing (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-sizzling-tofu',
    type: 'menu_item',
    name: 'Sizzling Tofu*',
    price: 140,
    category: 'Favorites',
    active: true,
    description: 'Crispy tofu cubes tossed with savory creamy dressing on a sizzling plate (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-sizzling-sisig-egg',
    type: 'menu_item',
    name: 'Sizzling Sisig with Egg*',
    price: 230,
    category: 'Favorites',
    active: true,
    description: 'Crispy seasoned minced pork sisig with onions, chili, and fresh egg on hot plate (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-sizzling-hotdog',
    type: 'menu_item',
    name: 'Sizzling Hotdog*',
    price: 150,
    category: 'Favorites',
    active: true,
    description: 'Sliced tender hotdogs sautéed with onions in savory sweet gravy (Hot kitchen).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-pancit-canton',
    type: 'menu_item',
    name: 'Pancit Canton',
    price: 130,
    category: 'Favorites',
    active: true,
    description: 'Stir-fried egg noodles with crisp vegetables, pork slices, and savory sauce.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-lomi',
    type: 'menu_item',
    name: 'Lomi',
    price: 130,
    category: 'Favorites',
    active: true,
    description: 'Thick egg noodle soup with rich savory broth, egg drops, and hearty meat toppings.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'fav-french-fries',
    type: 'menu_item',
    name: 'French Fries',
    price: 90,
    category: 'Favorites',
    active: true,
    description: 'Golden crispy shoestring potato fries with ketchup or mayo dip.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- KITCHEN EXTRAS ---
  {
    id: 'ext-plain-rice',
    type: 'menu_item',
    name: 'Plain Rice',
    price: 30,
    category: 'Kitchen Extras',
    active: true,
    description: 'Steamed fragrant white jasmine rice.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-garlic-rice',
    type: 'menu_item',
    name: 'Garlic Rice',
    price: 40,
    category: 'Kitchen Extras',
    active: true,
    description: 'Sinangag rice sautéed with toasted garlic chips.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-egg',
    type: 'menu_item',
    name: 'Egg (Fried/Boiled)',
    price: 20,
    category: 'Kitchen Extras',
    active: true,
    description: 'Farm fresh egg cooked to preference (sunny side up, scrambled, or hard-boiled).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-ice-bucket',
    type: 'menu_item',
    name: 'Ice Bucket',
    price: 30,
    category: 'Kitchen Extras',
    active: true,
    description: 'Full bucket of clean tube ice with stainless tongs.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'ext-hot-water',
    type: 'menu_item',
    name: 'Hot Water',
    price: 20,
    category: 'Kitchen Extras',
    active: true,
    description: 'Thermos carafe of boiling hot water for tea, coffee, or instant meals.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- DRINKS (Available 24/7) ---
  {
    id: 'drk-coke',
    type: 'menu_item',
    name: 'Coke',
    price: 60,
    category: 'Drinks',
    active: true,
    description: 'Chilled canned Coca-Cola regular 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-coke-zero',
    type: 'menu_item',
    name: 'Coke Zero',
    price: 60,
    category: 'Drinks',
    active: true,
    description: 'Chilled canned Coca-Cola Zero Sugar 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-sprite',
    type: 'menu_item',
    name: 'Sprite',
    price: 60,
    category: 'Drinks',
    active: true,
    description: 'Chilled canned Sprite lemon-lime soda 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-royal',
    type: 'menu_item',
    name: 'Royal',
    price: 60,
    category: 'Drinks',
    active: true,
    description: 'Chilled canned Royal Tru-Orange soda 320ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-pineapple-juice',
    type: 'menu_item',
    name: 'Pineapple Juice',
    price: 60,
    category: 'Drinks',
    active: true,
    description: 'Chilled Del Monte 100% pure pineapple juice in can.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-c2-apple',
    type: 'menu_item',
    name: 'C2 Apple',
    price: 60,
    category: 'Drinks',
    active: true,
    description: 'C2 Cool & Clean bottled green tea apple flavor 500ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-mineral-water',
    type: 'menu_item',
    name: 'Mineral Water',
    price: 25,
    category: 'Drinks',
    active: true,
    description: 'Purified bottled drinking water 500ml.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-coffee',
    type: 'menu_item',
    name: 'Coffee (Brown/Blanca)',
    price: 25,
    category: 'Drinks',
    active: true,
    description: 'Nescafe / Kopiko 3-in-1 coffee sachet with hot cup and water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-milo',
    type: 'menu_item',
    name: 'Milo',
    price: 25,
    category: 'Drinks',
    active: true,
    description: 'Nestle Milo chocolate malt energy drink with hot cup and water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-san-miguel-beer',
    type: 'menu_item',
    name: 'San Miguel Beer',
    price: 90,
    category: 'Drinks',
    active: true,
    description: 'San Miguel Pale Pilsen 330ml bottle, ice-cold.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-san-mig-light',
    type: 'menu_item',
    name: 'San Mig Light',
    price: 90,
    category: 'Drinks',
    active: true,
    description: 'San Mig Light low-calorie beer 330ml bottle, ice-cold.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'drk-redhorse',
    type: 'menu_item',
    name: 'Redhorse',
    price: 90,
    category: 'Drinks',
    active: true,
    description: 'Red Horse Extra Strong Beer 330ml bottle, ice-cold.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- MISCELLANEOUS (Available 24/7) ---
  {
    id: 'misc-cupnoodles-beef',
    type: 'menu_item',
    name: 'Cup Noodles (Beef)',
    price: 60,
    category: 'Miscellaneous',
    active: true,
    description: 'Nissin Cup Noodles Beef flavor with hot water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-cupnoodles-bulalo',
    type: 'menu_item',
    name: 'Cup Noodles (Bulalo)',
    price: 60,
    category: 'Miscellaneous',
    active: true,
    description: 'Nissin Cup Noodles Bulalo flavor with hot water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-cupnoodles-seafood',
    type: 'menu_item',
    name: 'Cup Noodles (Seafood)',
    price: 60,
    category: 'Miscellaneous',
    active: true,
    description: 'Nissin Cup Noodles Seafood flavor with hot water.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-piatos',
    type: 'menu_item',
    name: 'Piatos',
    price: 45,
    category: 'Miscellaneous',
    active: true,
    description: 'Jack & Jill Piattos potato chips snack pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-nova',
    type: 'menu_item',
    name: 'Nova',
    price: 45,
    category: 'Miscellaneous',
    active: true,
    description: 'Nova multigrain snack chips pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-pica',
    type: 'menu_item',
    name: 'Pic-A',
    price: 45,
    category: 'Miscellaneous',
    active: true,
    description: 'Pic-A assorted snack mix pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-vcut',
    type: 'menu_item',
    name: 'V-Cut',
    price: 45,
    category: 'Miscellaneous',
    active: true,
    description: 'Jack & Jill V-Cut ridged potato chips snack pack (40g).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-candy',
    type: 'menu_item',
    name: 'Halls / Snowbear Candy*',
    price: 20,
    category: 'Miscellaneous',
    active: true,
    description: 'Menthol soothing candy pack (Halls or Snowbear).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-marlboro-red',
    type: 'menu_item',
    name: 'Marlboro Red',
    price: 235,
    category: 'Miscellaneous',
    active: true,
    description: 'Marlboro Red cigarette pack (20 sticks).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-marlboro-lights',
    type: 'menu_item',
    name: 'Marlboro Lights',
    price: 235,
    category: 'Miscellaneous',
    active: true,
    description: 'Marlboro Lights / Gold cigarette pack (20 sticks).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-lighter',
    type: 'menu_item',
    name: 'Lighter',
    price: 35,
    category: 'Miscellaneous',
    active: true,
    description: 'Disposable gas lighter.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-condom',
    type: 'menu_item',
    name: 'Condom',
    price: 65,
    category: 'Miscellaneous',
    active: true,
    description: 'Lubricated premium latex condom (pack of 3).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-sanitary-napkin',
    type: 'menu_item',
    name: 'Sanitary Napkin',
    price: 25,
    category: 'Miscellaneous',
    active: true,
    description: 'Feminine sanitary pads with wings.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-pantiliner',
    type: 'menu_item',
    name: 'Pantiliner',
    price: 20,
    category: 'Miscellaneous',
    active: true,
    description: 'Breathable daily pantiliners pack.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-feminine-wash',
    type: 'menu_item',
    name: 'Feminine Wash',
    price: 25,
    category: 'Miscellaneous',
    active: true,
    description: 'Gentle intimate cleansing wash travel sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-tissue-roll',
    type: 'menu_item',
    name: 'Tissue Roll',
    price: 25,
    category: 'Miscellaneous',
    active: true,
    description: 'Soft 2-ply bathroom tissue roll.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-shaving-kit',
    type: 'menu_item',
    name: 'Shaving Kit',
    price: 25,
    category: 'Miscellaneous',
    active: true,
    description: 'Twin-blade disposable razor with shaving cream.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-soap-safeguard',
    type: 'menu_item',
    name: 'Soap (Safeguard)',
    price: 35,
    category: 'Miscellaneous',
    active: true,
    description: 'Safeguard antibacterial white bar soap 60g.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-shampoo',
    type: 'menu_item',
    name: 'Shampoo',
    price: 25,
    category: 'Miscellaneous',
    active: true,
    description: 'Revitalizing hair shampoo sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-conditioner',
    type: 'menu_item',
    name: 'Conditioner',
    price: 25,
    category: 'Miscellaneous',
    active: true,
    description: 'Moisturizing hair conditioner sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-toothpaste-sachet',
    type: 'menu_item',
    name: 'Toothpaste Sachet',
    price: 30,
    category: 'Miscellaneous',
    active: true,
    description: 'Colgate travel toothpaste sachet.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'misc-toothbrush',
    type: 'menu_item',
    name: 'Toothbrush',
    price: 40,
    category: 'Miscellaneous',
    active: true,
    description: 'Medium-soft sealed travel manual toothbrush.',
    imageUrl: 'https://placehold.co/400x300'
  },

  // --- GENERAL SERVICES & EXTRAS ---
  {
    id: 'extra-person',
    type: 'service',
    name: 'Extra Person',
    price: 150,
    category: 'Extras',
    active: true,
    description: 'Additional guest charge per night',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'extra-bed',
    type: 'service',
    name: 'Extra Bed',
    price: 250,
    category: 'Extras',
    active: true,
    description: 'Rollaway single mattress set',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'bed-sheet',
    type: 'service',
    name: 'Bed sheet',
    price: 150,
    category: 'Extras',
    active: true,
    description: 'Fresh clean single/double bedsheet',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'extra-bedsheet-set',
    type: 'service',
    name: 'Extra Bed (set)',
    price: 500,
    category: 'Extras',
    active: true,
    description: 'Complete bed set with mattress and linens',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'pillow',
    type: 'service',
    name: 'Pillow',
    price: 200,
    category: 'Extras',
    active: true,
    description: 'Extra fluffy head pillow',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'pillow-case',
    type: 'service',
    name: 'Pillow case',
    price: 100,
    category: 'Extras',
    active: true,
    description: 'Fresh replacement pillow protector',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'blanket',
    type: 'service',
    name: 'Blanket',
    price: 100,
    category: 'Extras',
    active: true,
    description: 'Cozy warm thermal blanket',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'towel',
    type: 'service',
    name: 'Towel',
    price: 100,
    category: 'Extras',
    active: true,
    description: 'Plush high-absorbency bath towel',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'supply-guest-kit',
    type: 'service',
    name: 'Guest Kit',
    price: 50,
    category: 'Extras',
    active: true,
    description: 'Complete guest amenity kit (hygiene, toiletries).',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'supply-beddings',
    type: 'service',
    name: 'Beddings Set',
    price: 200,
    category: 'Extras',
    active: true,
    description: 'Complete fresh beddings linen pack.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'laundry-regular',
    type: 'service',
    name: 'Regular Laundry (Per kg)',
    price: 120,
    category: 'Laundry',
    active: true,
    description: 'Wash, dry, and fold service. Next day delivery.',
    imageUrl: 'https://placehold.co/400x300'
  },
  {
    id: 'spa-relaxation',
    type: 'service',
    name: 'Swedish Relaxation Massage (60 mins)',
    price: 600,
    category: 'Spa',
    active: true,
    description: 'Full body swedish massage with custom aromatherapy oils.'
  },
  {
    id: 'late-checkout-extension',
    type: 'service',
    name: 'Excess Hour / Late Checkout Surcharge (per hr)',
    price: 130,
    category: 'Late Checkout',
    active: true,
    description: 'Additional ₱130 charged for every excess hour of stay.'
  }
];
