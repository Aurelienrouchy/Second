import { MeetupNeighborhood, MeetupSpot, MeetupSpotCategory } from '../types';

// Liste des quartiers de Montréal par arrondissement
export const MONTREAL_NEIGHBORHOODS: MeetupNeighborhood[] = [
  // Ville-Marie (Centre-ville)
  { id: 'downtown', name: 'Centre-ville', borough: 'Ville-Marie' },
  { id: 'old-montreal', name: 'Vieux-Montréal', borough: 'Ville-Marie' },
  { id: 'quartier-latin', name: 'Quartier Latin', borough: 'Ville-Marie' },
  { id: 'gay-village', name: 'Village', borough: 'Ville-Marie' },
  { id: 'quartier-des-spectacles', name: 'Quartier des Spectacles', borough: 'Ville-Marie' },

  // Le Plateau-Mont-Royal
  { id: 'plateau', name: 'Plateau Mont-Royal', borough: 'Le Plateau-Mont-Royal' },
  { id: 'mile-end', name: 'Mile End', borough: 'Le Plateau-Mont-Royal' },
  { id: 'laurier', name: 'Laurier', borough: 'Le Plateau-Mont-Royal' },
  { id: 'de-lorimier', name: 'De Lorimier', borough: 'Le Plateau-Mont-Royal' },

  // Rosemont–La Petite-Patrie
  { id: 'rosemont', name: 'Rosemont', borough: 'Rosemont–La Petite-Patrie' },
  { id: 'petite-patrie', name: 'Petite-Patrie', borough: 'Rosemont–La Petite-Patrie' },
  { id: 'little-italy', name: 'Petite Italie', borough: 'Rosemont–La Petite-Patrie' },
  { id: 'angus', name: 'Angus', borough: 'Rosemont–La Petite-Patrie' },

  // Hochelaga-Maisonneuve
  { id: 'hochelaga', name: 'Hochelaga', borough: 'Mercier–Hochelaga-Maisonneuve' },
  { id: 'maisonneuve', name: 'Maisonneuve', borough: 'Mercier–Hochelaga-Maisonneuve' },
  { id: 'mercier-ouest', name: 'Mercier-Ouest', borough: 'Mercier–Hochelaga-Maisonneuve' },
  { id: 'mercier-est', name: 'Mercier-Est', borough: 'Mercier–Hochelaga-Maisonneuve' },

  // Villeray–Saint-Michel–Parc-Extension
  { id: 'villeray', name: 'Villeray', borough: 'Villeray–Saint-Michel–Parc-Extension' },
  { id: 'saint-michel', name: 'Saint-Michel', borough: 'Villeray–Saint-Michel–Parc-Extension' },
  { id: 'parc-ex', name: 'Parc-Extension', borough: 'Villeray–Saint-Michel–Parc-Extension' },

  // Côte-des-Neiges–Notre-Dame-de-Grâce
  { id: 'cote-des-neiges', name: 'Côte-des-Neiges', borough: 'Côte-des-Neiges–Notre-Dame-de-Grâce' },
  { id: 'ndg', name: 'Notre-Dame-de-Grâce', borough: 'Côte-des-Neiges–Notre-Dame-de-Grâce' },
  { id: 'snowdon', name: 'Snowdon', borough: 'Côte-des-Neiges–Notre-Dame-de-Grâce' },

  // Le Sud-Ouest
  { id: 'griffintown', name: 'Griffintown', borough: 'Le Sud-Ouest' },
  { id: 'saint-henri', name: 'Saint-Henri', borough: 'Le Sud-Ouest' },
  { id: 'pointe-saint-charles', name: 'Pointe-Saint-Charles', borough: 'Le Sud-Ouest' },
  { id: 'verdun', name: 'Verdun', borough: 'Verdun' },

  // Outremont
  { id: 'outremont', name: 'Outremont', borough: 'Outremont' },

  // Ahuntsic-Cartierville
  { id: 'ahuntsic', name: 'Ahuntsic', borough: 'Ahuntsic-Cartierville' },
  { id: 'cartierville', name: 'Cartierville', borough: 'Ahuntsic-Cartierville' },
  { id: 'bordeaux', name: 'Bordeaux-Cartierville', borough: 'Ahuntsic-Cartierville' },

  // Montréal-Nord
  { id: 'montreal-nord', name: 'Montréal-Nord', borough: 'Montréal-Nord' },

  // Saint-Léonard
  { id: 'saint-leonard', name: 'Saint-Léonard', borough: 'Saint-Léonard' },

  // Anjou
  { id: 'anjou', name: 'Anjou', borough: 'Anjou' },

  // Rivière-des-Prairies–Pointe-aux-Trembles
  { id: 'rdp', name: 'Rivière-des-Prairies', borough: 'Rivière-des-Prairies–Pointe-aux-Trembles' },
  { id: 'pointe-aux-trembles', name: 'Pointe-aux-Trembles', borough: 'Rivière-des-Prairies–Pointe-aux-Trembles' },

  // LaSalle
  { id: 'lasalle', name: 'LaSalle', borough: 'LaSalle' },

  // Lachine
  { id: 'lachine', name: 'Lachine', borough: 'Lachine' },

  // Pierrefonds-Roxboro
  { id: 'pierrefonds', name: 'Pierrefonds', borough: 'Pierrefonds-Roxboro' },
  { id: 'roxboro', name: 'Roxboro', borough: 'Pierrefonds-Roxboro' },

  // Île-Bizard–Sainte-Geneviève
  { id: 'ile-bizard', name: 'Île-Bizard', borough: 'Île-Bizard–Sainte-Geneviève' },

  // Saint-Laurent
  { id: 'saint-laurent', name: 'Saint-Laurent', borough: 'Saint-Laurent' },

  // Westmount (ville liée)
  { id: 'westmount', name: 'Westmount', borough: 'Westmount' },

  // Côte-Saint-Luc (ville liée)
  { id: 'cote-saint-luc', name: 'Côte-Saint-Luc', borough: 'Côte-Saint-Luc' },

  // Mont-Royal (ville liée)
  { id: 'mont-royal', name: 'Mont-Royal', borough: 'Mont-Royal' },
];

// Grouper les quartiers par arrondissement
export const NEIGHBORHOODS_BY_BOROUGH = MONTREAL_NEIGHBORHOODS.reduce(
  (acc, neighborhood) => {
    if (!acc[neighborhood.borough]) {
      acc[neighborhood.borough] = [];
    }
    acc[neighborhood.borough].push(neighborhood);
    return acc;
  },
  {} as Record<string, MeetupNeighborhood[]>
);

// Obtenir un quartier par son ID
export const getNeighborhoodById = (id: string): MeetupNeighborhood | undefined => {
  return MONTREAL_NEIGHBORHOODS.find((n) => n.id === id);
};

// Rechercher des quartiers par nom
export const searchNeighborhoods = (query: string): MeetupNeighborhood[] => {
  const normalizedQuery = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return MONTREAL_NEIGHBORHOODS.filter((n) => {
    const normalizedName = n.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedBorough = n.borough.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return normalizedName.includes(normalizedQuery) || normalizedBorough.includes(normalizedQuery);
  });
};

// Lieux de rencontre populaires pré-définis par quartier
export const POPULAR_MEETUP_SPOTS: Record<string, MeetupSpot[]> = {
  'mile-end': [
    {
      name: 'Café Olympico',
      category: 'cafe',
      neighborhood: getNeighborhoodById('mile-end')!,
      address: '124 Rue Saint-Viateur O',
    },
    {
      name: 'Station Laurier',
      category: 'metro',
      neighborhood: getNeighborhoodById('mile-end')!,
    },
    {
      name: 'Parc Jeanne-Mance',
      category: 'park',
      neighborhood: getNeighborhoodById('mile-end')!,
    },
  ],
  'plateau': [
    {
      name: 'Station Mont-Royal',
      category: 'metro',
      neighborhood: getNeighborhoodById('plateau')!,
    },
    {
      name: 'Bibliothèque du Plateau',
      category: 'library',
      neighborhood: getNeighborhoodById('plateau')!,
      address: '465 Avenue du Mont-Royal E',
    },
    {
      name: 'Café Santropol',
      category: 'cafe',
      neighborhood: getNeighborhoodById('plateau')!,
      address: '3990 Rue Saint-Urbain',
    },
  ],
  'downtown': [
    {
      name: 'Centre Eaton',
      category: 'mall',
      neighborhood: getNeighborhoodById('downtown')!,
      address: '705 Rue Sainte-Catherine O',
    },
    {
      name: 'Station McGill',
      category: 'metro',
      neighborhood: getNeighborhoodById('downtown')!,
    },
    {
      name: 'Station Berri-UQAM',
      category: 'metro',
      neighborhood: getNeighborhoodById('downtown')!,
    },
    {
      name: 'Place Ville Marie',
      category: 'mall',
      neighborhood: getNeighborhoodById('downtown')!,
    },
  ],
  'rosemont': [
    {
      name: 'Station Rosemont',
      category: 'metro',
      neighborhood: getNeighborhoodById('rosemont')!,
    },
    {
      name: 'Station Beaubien',
      category: 'metro',
      neighborhood: getNeighborhoodById('rosemont')!,
    },
    {
      name: 'Maison de la culture Rosemont',
      category: 'community_center',
      neighborhood: getNeighborhoodById('rosemont')!,
      address: '6707 Avenue de Lorimier',
    },
  ],
  'hochelaga': [
    {
      name: 'Station Préfontaine',
      category: 'metro',
      neighborhood: getNeighborhoodById('hochelaga')!,
    },
    {
      name: 'Promenade Ontario',
      category: 'other_public',
      neighborhood: getNeighborhoodById('hochelaga')!,
    },
  ],
  'ndg': [
    {
      name: 'Station Vendôme',
      category: 'metro',
      neighborhood: getNeighborhoodById('ndg')!,
    },
    {
      name: 'Monkland Village',
      category: 'other_public',
      neighborhood: getNeighborhoodById('ndg')!,
    },
  ],
  'saint-henri': [
    {
      name: 'Station Place-Saint-Henri',
      category: 'metro',
      neighborhood: getNeighborhoodById('saint-henri')!,
    },
    {
      name: 'Station Lionel-Groulx',
      category: 'metro',
      neighborhood: getNeighborhoodById('saint-henri')!,
    },
  ],
  'griffintown': [
    {
      name: 'Station Lucien-L\'Allier',
      category: 'metro',
      neighborhood: getNeighborhoodById('griffintown')!,
    },
    {
      name: 'Marché Atwater',
      category: 'other_public',
      neighborhood: getNeighborhoodById('griffintown')!,
      address: '138 Avenue Atwater',
    },
  ],
  'villeray': [
    {
      name: 'Station Jean-Talon',
      category: 'metro',
      neighborhood: getNeighborhoodById('villeray')!,
    },
    {
      name: 'Marché Jean-Talon',
      category: 'other_public',
      neighborhood: getNeighborhoodById('villeray')!,
    },
  ],
  'little-italy': [
    {
      name: 'Marché Jean-Talon',
      category: 'other_public',
      neighborhood: getNeighborhoodById('little-italy')!,
      address: '7070 Avenue Henri-Julien',
    },
    {
      name: 'Café Italia',
      category: 'cafe',
      neighborhood: getNeighborhoodById('little-italy')!,
      address: '6840 Boulevard Saint-Laurent',
    },
  ],
};

// Obtenir les spots populaires pour un quartier
export const getPopularSpotsForNeighborhood = (neighborhoodId: string): MeetupSpot[] => {
  return POPULAR_MEETUP_SPOTS[neighborhoodId] || [];
};

// Obtenir tous les spots populaires
export const getAllPopularSpots = (): MeetupSpot[] => {
  return Object.values(POPULAR_MEETUP_SPOTS).flat();
};
