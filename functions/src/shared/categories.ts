/**
 * SINGLE SOURCE OF TRUTH FOR CATEGORIES
 * Used by both the app and Firebase Cloud Functions
 */

export interface CategoryNode {
  id: string;
  label: string;
  icon?: string;
  children?: CategoryNode[];
}

// Helper to generate ID from path (exported for potential use in scripts)
export function generateIdFromPath(parts: string[]): string {
  return parts
    .map(p => p.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
    )
    .join('_');
}

// ============================================
// MAIN CATEGORY TREE
// ============================================

export const CATEGORIES: CategoryNode[] = [
  {
    id: 'women',
    label: 'Femmes',
    icon: 'woman',
    children: [
      {
        id: 'women_clothing',
        label: 'Vêtements',
        children: [
          {
            id: 'women_clothing_coats',
            label: 'Manteaux et vestes',
            children: [
              { id: 'women_clothing_coats_all', label: 'Tous' },
              { id: 'women_clothing_coats_capes', label: 'Capes et ponchos' },
              {
                id: 'women_clothing_coats_coats',
                label: 'Manteaux',
                children: [
                  { id: 'women_clothing_coats_coats_duffle', label: 'Duffle-coats' },
                  { id: 'women_clothing_coats_coats_faux_fur', label: 'Manteaux en fausse fourrure' },
                  { id: 'women_clothing_coats_coats_long', label: 'Pardessus et manteaux longs' },
                  { id: 'women_clothing_coats_coats_parkas', label: 'Parkas' },
                  { id: 'women_clothing_coats_coats_peacoats', label: 'Cabans' },
                  { id: 'women_clothing_coats_coats_raincoats', label: 'Imperméables' },
                  { id: 'women_clothing_coats_coats_trench', label: 'Trenchs' },
                ]
              },
              { id: 'women_clothing_coats_vests', label: 'Vestes sans manches' },
              {
                id: 'women_clothing_coats_jackets',
                label: 'Vestes',
                children: [
                  { id: 'women_clothing_coats_jackets_biker', label: 'Perfectos et blousons de moto' },
                  { id: 'women_clothing_coats_jackets_bomber', label: 'Blousons aviateur' },
                  { id: 'women_clothing_coats_jackets_denim', label: 'Vestes en jean' },
                  { id: 'women_clothing_coats_jackets_military', label: 'Vestes militaires et utilitaires' },
                  { id: 'women_clothing_coats_jackets_fleece', label: 'Vestes polaires' },
                  { id: 'women_clothing_coats_jackets_puffer', label: 'Doudounes' },
                  { id: 'women_clothing_coats_jackets_quilted', label: 'Vestes matelassées' },
                  { id: 'women_clothing_coats_jackets_shirt', label: 'Vestes chemises' },
                  { id: 'women_clothing_coats_jackets_ski', label: 'Vestes de ski et snowboard' },
                  { id: 'women_clothing_coats_jackets_teddy', label: 'Blousons teddy' },
                  { id: 'women_clothing_coats_jackets_windbreaker', label: 'Vestes coupe-vent' },
                ]
              },
            ]
          },
          {
            id: 'women_clothing_sweaters',
            label: 'Sweats et sweats à capuche',
            children: [
              { id: 'women_clothing_sweaters_hoodies', label: 'Sweats & sweats à capuche' },
              {
                id: 'women_clothing_sweaters_sweaters',
                label: 'Sweats',
                children: [
                  { id: 'women_clothing_sweaters_sweaters_vneck', label: 'Pulls col V' },
                  { id: 'women_clothing_sweaters_sweaters_turtleneck', label: 'Pulls col roulé' },
                  { id: 'women_clothing_sweaters_sweaters_long', label: 'Sweats longs' },
                  { id: 'women_clothing_sweaters_sweaters_winter', label: "Pulls d'hiver" },
                  { id: 'women_clothing_sweaters_sweaters_34sleeve', label: 'Sweats manche ¾' },
                  { id: 'women_clothing_sweaters_sweaters_other', label: 'Autres sweats' },
                ]
              },
              { id: 'women_clothing_sweaters_kimonos', label: 'Kimonos' },
              { id: 'women_clothing_sweaters_cardigans', label: 'Cardigans' },
              { id: 'women_clothing_sweaters_boleros', label: 'Boléros' },
              { id: 'women_clothing_sweaters_jackets', label: 'Vestes' },
              { id: 'women_clothing_sweaters_other', label: 'Autres pull-overs & sweat-shirts' },
            ]
          },
          {
            id: 'women_clothing_blazers',
            label: 'Blazers et tailleurs',
            children: [
              { id: 'women_clothing_blazers_blazers', label: 'Blazers' },
              { id: 'women_clothing_blazers_suits_pants', label: 'Ensembles tailleur/pantalon' },
              { id: 'women_clothing_blazers_suits_skirts', label: 'Jupes et robes tailleurs' },
              { id: 'women_clothing_blazers_suits_separates', label: 'Tailleurs pièces séparées' },
              { id: 'women_clothing_blazers_other', label: 'Autres ensembles & tailleurs' },
            ]
          },
          {
            id: 'women_clothing_dresses',
            label: 'Robes',
            children: [
              { id: 'women_clothing_dresses_mini', label: 'Mini' },
              { id: 'women_clothing_dresses_midi', label: 'Midi' },
              { id: 'women_clothing_dresses_long', label: 'Robes longues' },
              {
                id: 'women_clothing_dresses_occasion',
                label: 'Pour occasions',
                children: [
                  { id: 'women_clothing_dresses_occasion_cocktail', label: 'Fêtes et cocktails' },
                  { id: 'women_clothing_dresses_occasion_wedding', label: 'Robes de mariée' },
                  { id: 'women_clothing_dresses_occasion_prom', label: 'Robes de bal de fin d\'année' },
                  { id: 'women_clothing_dresses_occasion_evening', label: 'Robes de soirée' },
                  { id: 'women_clothing_dresses_occasion_backless', label: 'Robes dos nu' },
                ]
              },
              { id: 'women_clothing_dresses_summer', label: "Robes d'été" },
              { id: 'women_clothing_dresses_winter', label: "Robes d'hiver" },
              { id: 'women_clothing_dresses_chic', label: 'Robes chics' },
              { id: 'women_clothing_dresses_casual', label: 'Robes casual' },
              { id: 'women_clothing_dresses_strapless', label: 'Robes sans bretelles' },
              { id: 'women_clothing_dresses_lbd', label: 'Petites robes noires' },
              { id: 'women_clothing_dresses_denim', label: 'Robes en jean' },
              { id: 'women_clothing_dresses_other', label: 'Autres robes' },
            ]
          },
          {
            id: 'women_clothing_skirts',
            label: 'Jupes',
            children: [
              { id: 'women_clothing_skirts_mini', label: 'Minijupes' },
              { id: 'women_clothing_skirts_knee', label: 'Jupes longueur genou' },
              { id: 'women_clothing_skirts_midi', label: 'Jupes midi' },
              { id: 'women_clothing_skirts_long', label: 'Jupes longues' },
              { id: 'women_clothing_skirts_asymmetric', label: 'Jupes asymétriques' },
              { id: 'women_clothing_skirts_skorts', label: 'Jupes-shorts' },
            ]
          },
          {
            id: 'women_clothing_tops',
            label: 'Hauts et t-shirts',
            children: [
              { id: 'women_clothing_tops_shirts', label: 'Chemises' },
              { id: 'women_clothing_tops_blouses', label: 'Blouses' },
              { id: 'women_clothing_tops_jackets', label: 'Vestes' },
              { id: 'women_clothing_tops_tshirts', label: 'T-shirts' },
              { id: 'women_clothing_tops_tanks', label: 'Débardeurs' },
              { id: 'women_clothing_tops_tunics', label: 'Tuniques' },
              { id: 'women_clothing_tops_crop', label: 'Tops courts' },
              { id: 'women_clothing_tops_blouses_short', label: 'Blouses manches courtes' },
              { id: 'women_clothing_tops_blouses_34', label: 'Blouses ¾' },
              { id: 'women_clothing_tops_blouses_long', label: 'Blouses manches longues' },
              { id: 'women_clothing_tops_bodysuits', label: 'Bodies' },
              { id: 'women_clothing_tops_offshoulder', label: 'Tops épaules dénudées' },
              { id: 'women_clothing_tops_turtleneck', label: 'Cols roulés' },
              { id: 'women_clothing_tops_peplum', label: 'Tops peplum' },
              { id: 'women_clothing_tops_backless', label: 'Tops dos nu' },
              { id: 'women_clothing_tops_other', label: 'Autres hauts' },
            ]
          },
          {
            id: 'women_clothing_jeans',
            label: 'Jeans',
            children: [
              { id: 'women_clothing_jeans_boyfriend', label: 'Jeans boyfriend' },
              { id: 'women_clothing_jeans_cropped', label: 'Jeans courts' },
              { id: 'women_clothing_jeans_flare', label: 'Jeans évasés' },
              { id: 'women_clothing_jeans_highwaist', label: 'Jeans taille haute' },
              { id: 'women_clothing_jeans_ripped', label: 'Jeans troués' },
              { id: 'women_clothing_jeans_skinny', label: 'Jeans skinny' },
              { id: 'women_clothing_jeans_straight', label: 'Jeans droits' },
              { id: 'women_clothing_jeans_other', label: 'Autre' },
            ]
          },
          {
            id: 'women_clothing_pants',
            label: 'Pantalons et leggings',
            children: [
              { id: 'women_clothing_pants_chinos', label: 'Pantalons courts & chinos' },
              { id: 'women_clothing_pants_wide', label: 'Pantalons à jambes larges' },
              { id: 'women_clothing_pants_skinny', label: 'Pantalons skinny' },
              { id: 'women_clothing_pants_fitted', label: 'Pantalons ajustés' },
              { id: 'women_clothing_pants_straight', label: 'Pantalons droits' },
              { id: 'women_clothing_pants_leather', label: 'Pantalons en cuir' },
              { id: 'women_clothing_pants_leggings', label: 'Leggings' },
              { id: 'women_clothing_pants_harem', label: 'Sarouels' },
              { id: 'women_clothing_pants_other', label: 'Autres pantalons' },
            ]
          },
          {
            id: 'women_clothing_shorts',
            label: 'Shorts',
            children: [
              { id: 'women_clothing_shorts_lowrise', label: 'Shorts taille basse' },
              { id: 'women_clothing_shorts_highrise', label: 'Shorts taille haute' },
              { id: 'women_clothing_shorts_knee', label: 'Shorts longueur genou' },
              { id: 'women_clothing_shorts_denim', label: 'Short en jean' },
              { id: 'women_clothing_shorts_lace', label: 'Shorts en dentelle' },
              { id: 'women_clothing_shorts_leather', label: 'Shorts en cuir' },
              { id: 'women_clothing_shorts_cargo', label: 'Shorts cargo' },
              { id: 'women_clothing_shorts_capri', label: 'Pantacourts' },
              { id: 'women_clothing_shorts_other', label: 'Autres shorts' },
            ]
          },
          {
            id: 'women_clothing_jumpsuits',
            label: 'Combinaisons et combishorts',
            children: [
              { id: 'women_clothing_jumpsuits_jumpsuits', label: 'Combinaisons' },
              { id: 'women_clothing_jumpsuits_rompers', label: 'Combi Shorts' },
              { id: 'women_clothing_jumpsuits_other', label: 'Autres combinaisons & combishorts' },
            ]
          },
          {
            id: 'women_clothing_swimwear',
            label: 'Maillots de bain',
            children: [
              { id: 'women_clothing_swimwear_onepiece', label: 'Une pièce' },
              { id: 'women_clothing_swimwear_twopiece', label: 'Deux pièces' },
              { id: 'women_clothing_swimwear_coverups', label: 'Paréos et sarongs' },
              { id: 'women_clothing_swimwear_other', label: 'Autres' },
            ]
          },
          {
            id: 'women_clothing_lingerie',
            label: 'Lingerie et pyjamas',
            children: [
              { id: 'women_clothing_lingerie_bras', label: 'Soutiens-gorge' },
              { id: 'women_clothing_lingerie_panties', label: 'Culottes' },
              { id: 'women_clothing_lingerie_sets', label: 'Ensembles' },
              { id: 'women_clothing_lingerie_shapewear', label: 'Gaines' },
              { id: 'women_clothing_lingerie_sleepwear', label: 'Pyjamas et tenues de nuit' },
              { id: 'women_clothing_lingerie_robes', label: 'Peignoirs' },
              { id: 'women_clothing_lingerie_tights', label: 'Collants' },
              { id: 'women_clothing_lingerie_socks', label: 'Chaussettes' },
              { id: 'women_clothing_lingerie_accessories', label: 'Accessoires de lingerie' },
              { id: 'women_clothing_lingerie_other', label: 'Autres' },
            ]
          },
          {
            id: 'women_clothing_maternity',
            label: 'Maternité',
            children: [
              { id: 'women_clothing_maternity_tops', label: 'Tops maternité' },
              { id: 'women_clothing_maternity_dresses', label: 'Robes maternité' },
              { id: 'women_clothing_maternity_skirts', label: 'Jupes maternité' },
              { id: 'women_clothing_maternity_pants', label: 'Pantalons maternité' },
              { id: 'women_clothing_maternity_shorts', label: 'Shorts maternité' },
              { id: 'women_clothing_maternity_jumpsuits', label: 'Combinaisons & combi shorts maternité' },
              { id: 'women_clothing_maternity_hoodies', label: 'Pulls à capuche & pulls maternité' },
              { id: 'women_clothing_maternity_coats', label: 'Manteaux & vestes maternité' },
              { id: 'women_clothing_maternity_swimwear', label: 'Maillots & tenues de plage maternité' },
              {
                id: 'women_clothing_maternity_underwear',
                label: 'Sous-vêtements maternité',
                children: [
                  { id: 'women_clothing_maternity_underwear_general', label: 'Sous-vêtements maternité' },
                  { id: 'women_clothing_maternity_underwear_sleepwear', label: 'Tenues de nuit maternité' },
                  { id: 'women_clothing_maternity_underwear_nursing', label: 'Soutiens-gorge grossesse & allaitement' },
                ]
              },
              { id: 'women_clothing_maternity_sport', label: 'Vêtements de sport' },
            ]
          },
          {
            id: 'women_clothing_sport',
            label: 'Vêtements de sport',
            children: [
              { id: 'women_clothing_sport_outerwear', label: "Vêtements d'extérieur" },
              { id: 'women_clothing_sport_tracksuits', label: 'Survêtements' },
              { id: 'women_clothing_sport_pants', label: 'Pantalons & leggings' },
              { id: 'women_clothing_sport_shorts', label: 'Shorts' },
              { id: 'women_clothing_sport_dresses', label: 'Robes' },
              { id: 'women_clothing_sport_skirts', label: 'Jupes' },
              { id: 'women_clothing_sport_tops', label: 'Hauts & t-shirts' },
              { id: 'women_clothing_sport_jerseys', label: 'Maillots' },
              { id: 'women_clothing_sport_hoodies', label: 'Sweats et sweats à capuche' },
              {
                id: 'women_clothing_sport_accessories',
                label: 'Accessoires de sports',
                children: [
                  { id: 'women_clothing_sport_accessories_eyewear', label: 'Lunettes' },
                  { id: 'women_clothing_sport_accessories_gloves', label: 'Gants' },
                  { id: 'women_clothing_sport_accessories_hats', label: 'Chapeaux' },
                  { id: 'women_clothing_sport_accessories_scarves', label: 'Écharpes' },
                  { id: 'women_clothing_sport_accessories_wristbands', label: 'Bracelets' },
                ]
              },
              { id: 'women_clothing_sport_bras', label: 'Brassières' },
              { id: 'women_clothing_sport_other', label: 'Autres' },
            ]
          },
          { id: 'women_clothing_costumes', label: 'Costumes et tenues particulières' },
          { id: 'women_clothing_other', label: 'Autres' },
        ]
      },
      {
        id: 'women_shoes',
        label: 'Chaussures',
        children: [
          { id: 'women_shoes_flats', label: 'Ballerines' },
          { id: 'women_shoes_loafers', label: 'Mocassins et chaussures bateau' },
          {
            id: 'women_shoes_boots',
            label: 'Bottes',
            children: [
              { id: 'women_shoes_boots_ankle', label: 'Bottines' },
              { id: 'women_shoes_boots_mid', label: 'Bottes mi-hautes' },
              { id: 'women_shoes_boots_knee', label: 'Bottes hautes' },
              { id: 'women_shoes_boots_over_knee', label: 'Cuissardes' },
              { id: 'women_shoes_boots_snow', label: 'Bottes de neige' },
              { id: 'women_shoes_boots_rain', label: 'Bottes de pluie' },
              { id: 'women_shoes_boots_work', label: 'Bottes de travail' },
            ]
          },
          { id: 'women_shoes_mules', label: 'Mules et sabots' },
          { id: 'women_shoes_espadrilles', label: 'Espadrilles' },
          { id: 'women_shoes_flipflops', label: 'Claquettes et tongs' },
          { id: 'women_shoes_heels', label: 'Chaussures à talons' },
          { id: 'women_shoes_laceups', label: 'Chaussures à lacets' },
          { id: 'women_shoes_maryjane', label: 'Babies et Mary-Jane' },
          { id: 'women_shoes_sandals', label: 'Sandales' },
          { id: 'women_shoes_slippers', label: 'Chaussons et pantoufles' },
          {
            id: 'women_shoes_sport',
            label: 'Chaussures de sport',
            children: [
              { id: 'women_shoes_sport_basketball', label: 'Basket' },
              { id: 'women_shoes_sport_climbing', label: 'Escalade' },
              { id: 'women_shoes_sport_cycling', label: 'Cyclisme' },
              { id: 'women_shoes_sport_dance', label: 'Danse' },
              { id: 'women_shoes_sport_football', label: 'Foot' },
              { id: 'women_shoes_sport_golf', label: 'Golf' },
              { id: 'women_shoes_sport_hiking', label: 'Randonnée' },
              { id: 'women_shoes_sport_iceskating', label: 'Patins à glace' },
              { id: 'women_shoes_sport_indoor', label: 'Foot en salle' },
              { id: 'women_shoes_sport_fitness', label: 'Fitness' },
              { id: 'women_shoes_sport_motorcycle', label: 'Bottes de moto' },
              { id: 'women_shoes_sport_skating', label: 'Patins à roulettes et rollers' },
              { id: 'women_shoes_sport_running', label: 'Course' },
              { id: 'women_shoes_sport_ski', label: 'Ski' },
              { id: 'women_shoes_sport_snowboard', label: 'Snowboard' },
              { id: 'women_shoes_sport_water', label: 'Aquatiques' },
              { id: 'women_shoes_sport_tennis', label: 'Tennis' },
            ]
          },
          { id: 'women_shoes_sneakers', label: 'Baskets' },
        ]
      },
      {
        id: 'women_bags',
        label: 'Sacs',
        children: [
          { id: 'women_bags_backpacks', label: 'Sacs à dos' },
          { id: 'women_bags_beach', label: 'Sacs de plage' },
          { id: 'women_bags_briefcases', label: 'Mallettes' },
          { id: 'women_bags_bucket', label: 'Sacs seau' },
          { id: 'women_bags_bumbags', label: 'Sacs banane' },
          { id: 'women_bags_clutches', label: 'Pochettes' },
          { id: 'women_bags_garment', label: 'Housses pour vêtements' },
          { id: 'women_bags_gym', label: 'Sacs de sport' },
          { id: 'women_bags_handbags', label: 'Sacs à main' },
          { id: 'women_bags_messenger', label: 'Besaces' },
          { id: 'women_bags_duffle', label: 'Fourre-tout et sacs marins' },
          { id: 'women_bags_travel', label: 'Sacs de voyage' },
          { id: 'women_bags_makeup', label: 'Trousses à maquillage' },
          { id: 'women_bags_satchels', label: 'Cartables et sacoches' },
          { id: 'women_bags_crossbody', label: 'Sacs à bandoulière' },
          { id: 'women_bags_tote', label: 'Sacs fourre-tout' },
          { id: 'women_bags_wallets', label: 'Porte-monnaie' },
          { id: 'women_bags_wristlets', label: 'Wristlets' },
        ]
      },
      {
        id: 'women_accessories',
        label: 'Accessoires',
        children: [
          { id: 'women_accessories_bandanas', label: 'Bandanas et foulards pour cheveux' },
          { id: 'women_accessories_belts', label: 'Ceintures' },
          { id: 'women_accessories_gloves', label: 'Gants' },
          { id: 'women_accessories_hair', label: 'Accessoires pour cheveux' },
          { id: 'women_accessories_pocketsquares', label: 'Mouchoirs de poche' },
          {
            id: 'women_accessories_hats',
            label: 'Chapeaux & casquettes',
            children: [
              { id: 'women_accessories_hats_balaclavas', label: 'Cagoules' },
              { id: 'women_accessories_hats_beanies', label: 'Bonnets' },
              { id: 'women_accessories_hats_caps', label: 'Casquettes' },
              { id: 'women_accessories_hats_earmuffs', label: 'Cache-oreilles' },
              { id: 'women_accessories_hats_fascinators', label: 'Fascinators' },
              { id: 'women_accessories_hats_hats', label: 'Chapeaux' },
              { id: 'women_accessories_hats_headbands', label: 'Bandeaux' },
            ]
          },
          {
            id: 'women_accessories_jewelry',
            label: 'Bijoux',
            children: [
              { id: 'women_accessories_jewelry_anklets', label: 'Bracelets de cheville' },
              { id: 'women_accessories_jewelry_body', label: 'Bijoux de corps' },
              { id: 'women_accessories_jewelry_bracelets', label: 'Bracelets' },
              { id: 'women_accessories_jewelry_brooches', label: 'Broches' },
              { id: 'women_accessories_jewelry_charms', label: 'Breloques et pendentifs' },
              { id: 'women_accessories_jewelry_earrings', label: "Boucles d'oreilles" },
              { id: 'women_accessories_jewelry_sets', label: 'Ensembles de bijoux' },
              { id: 'women_accessories_jewelry_necklaces', label: 'Colliers' },
              { id: 'women_accessories_jewelry_rings', label: 'Bagues' },
              { id: 'women_accessories_jewelry_other', label: 'Autres bijoux' },
            ]
          },
          { id: 'women_accessories_keychains', label: 'Porte-clés' },
          { id: 'women_accessories_scarves', label: 'Écharpes et châles' },
          { id: 'women_accessories_sunglasses', label: 'Lunettes de soleil' },
          { id: 'women_accessories_umbrellas', label: 'Parapluies' },
          { id: 'women_accessories_watches', label: 'Montres' },
          { id: 'women_accessories_other', label: 'Autres accessoires' },
        ]
      },
      {
        id: 'women_beauty',
        label: 'Beauté',
        children: [
          { id: 'women_beauty_makeup', label: 'Maquillage' },
          { id: 'women_beauty_perfume', label: 'Parfums' },
          { id: 'women_beauty_skincare', label: 'Soins du visage' },
          {
            id: 'women_beauty_accessories',
            label: 'Accessoires de beauté',
            children: [
              { id: 'women_beauty_accessories_hair', label: 'Accessoires soins capillaires' },
              { id: 'women_beauty_accessories_face', label: 'Accessoires soins du visage' },
              { id: 'women_beauty_accessories_body', label: 'Accessoires soins corporels' },
              { id: 'women_beauty_accessories_nails', label: 'Accessoires soins des ongles' },
              { id: 'women_beauty_accessories_makeup', label: 'Accessoires maquillage' },
            ]
          },
          { id: 'women_beauty_handcare', label: 'Soin mains' },
          { id: 'women_beauty_manicure', label: 'Manucure' },
          { id: 'women_beauty_bodycare', label: 'Soins du corps' },
          { id: 'women_beauty_haircare', label: 'Soins cheveux' },
          { id: 'women_beauty_other', label: 'Autres cosmétiques et accessoires' },
        ]
      },
    ]
  },
  {
    id: 'men',
    label: 'Hommes',
    icon: 'man',
    children: [
      {
        id: 'men_clothing',
        label: 'Vêtements',
        children: [
          {
            id: 'men_clothing_jeans',
            label: 'Jeans',
            children: [
              { id: 'men_clothing_jeans_ripped', label: 'Jeans troués' },
              { id: 'men_clothing_jeans_skinny', label: 'Jeans skinny' },
              { id: 'men_clothing_jeans_slim', label: 'Jeans slim' },
              { id: 'men_clothing_jeans_straight', label: 'Jeans coupe droite' },
            ]
          },
          {
            id: 'men_clothing_coats',
            label: 'Manteaux et vestes',
            children: [
              {
                id: 'men_clothing_coats_coats',
                label: 'Manteaux',
                children: [
                  { id: 'men_clothing_coats_coats_duffle', label: 'Duffle-coats' },
                  { id: 'men_clothing_coats_coats_long', label: 'Pardessus et manteaux longs' },
                  { id: 'men_clothing_coats_coats_parkas', label: 'Parkas' },
                  { id: 'men_clothing_coats_coats_peacoats', label: 'Cabans' },
                  { id: 'men_clothing_coats_coats_raincoats', label: 'Imperméables' },
                  { id: 'men_clothing_coats_coats_trench', label: 'Trenchs' },
                ]
              },
              { id: 'men_clothing_coats_vests', label: 'Vestes sans manches' },
              {
                id: 'men_clothing_coats_jackets',
                label: 'Vestes',
                children: [
                  { id: 'men_clothing_coats_jackets_biker', label: 'Perfectos et blousons de moto' },
                  { id: 'men_clothing_coats_jackets_bomber', label: 'Blousons aviateur' },
                  { id: 'men_clothing_coats_jackets_denim', label: 'Vestes en jean' },
                  { id: 'men_clothing_coats_jackets_military', label: 'Vestes militaires et utilitaires' },
                  { id: 'men_clothing_coats_jackets_fleece', label: 'Vestes polaires' },
                  { id: 'men_clothing_coats_jackets_harrington', label: 'Vestes Harrington' },
                  { id: 'men_clothing_coats_jackets_puffer', label: 'Doudounes' },
                  { id: 'men_clothing_coats_jackets_quilted', label: 'Vestes matelassées' },
                  { id: 'men_clothing_coats_jackets_shirt', label: 'Vestes chemises' },
                  { id: 'men_clothing_coats_jackets_ski', label: 'Vestes de ski et snowboard' },
                  { id: 'men_clothing_coats_jackets_teddy', label: 'Blousons teddy' },
                  { id: 'men_clothing_coats_jackets_windbreaker', label: 'Vestes coupe-vent' },
                ]
              },
              { id: 'men_clothing_coats_ponchos', label: 'Ponchos' },
            ]
          },
          {
            id: 'men_clothing_tops',
            label: 'Hauts et t-shirts',
            children: [
              {
                id: 'men_clothing_tops_shirts',
                label: 'Chemises',
                children: [
                  { id: 'men_clothing_tops_shirts_plaid', label: 'Chemises à carreaux' },
                  { id: 'men_clothing_tops_shirts_denim', label: 'Chemises en jean' },
                  { id: 'men_clothing_tops_shirts_solid', label: 'Chemises unies' },
                  { id: 'men_clothing_tops_shirts_patterned', label: 'Chemises à motifs' },
                  { id: 'men_clothing_tops_shirts_striped', label: 'Chemises à rayures' },
                  { id: 'men_clothing_tops_shirts_other', label: 'Autres chemises' },
                ]
              },
              {
                id: 'men_clothing_tops_tshirts',
                label: 'T-shirts',
                children: [
                  { id: 'men_clothing_tops_tshirts_solid', label: 'T-shirts unis' },
                  { id: 'men_clothing_tops_tshirts_printed', label: 'T-shirts imprimés' },
                  { id: 'men_clothing_tops_tshirts_striped', label: 'T-shirts à rayures' },
                  { id: 'men_clothing_tops_tshirts_polos', label: 'Polos' },
                  { id: 'men_clothing_tops_tshirts_longsleeve', label: 'T-shirts à manches longues' },
                  { id: 'men_clothing_tops_tshirts_other', label: 'Autres T-shirts' },
                ]
              },
              { id: 'men_clothing_tops_tanks', label: 'T-shirts sans manches' },
            ]
          },
          {
            id: 'men_clothing_suits',
            label: 'Costumes et blazers',
            children: [
              { id: 'men_clothing_suits_blazers', label: 'Blazers' },
              { id: 'men_clothing_suits_pants', label: 'Pantalons de costume' },
              { id: 'men_clothing_suits_vests', label: 'Gilets de costume' },
              { id: 'men_clothing_suits_sets', label: 'Ensembles costume' },
              { id: 'men_clothing_suits_wedding', label: 'Costumes de mariage' },
              { id: 'men_clothing_suits_other', label: 'Autres' },
            ]
          },
          {
            id: 'men_clothing_sweaters',
            label: 'Sweats et pulls',
            children: [
              { id: 'men_clothing_sweaters_sweats', label: 'Sweats' },
              { id: 'men_clothing_sweaters_hoodies', label: 'Pulls et pulls à capuche' },
              { id: 'men_clothing_sweaters_zip', label: 'Pulls à capuche avec zip' },
              { id: 'men_clothing_sweaters_cardigans', label: 'Cardigans' },
              { id: 'men_clothing_sweaters_crewneck', label: 'Pulls ras de cou' },
              { id: 'men_clothing_sweaters_vneck', label: 'Sweats à col V' },
              { id: 'men_clothing_sweaters_turtleneck', label: 'Pulls à col roulé' },
              { id: 'men_clothing_sweaters_long', label: 'Sweats longs' },
              { id: 'men_clothing_sweaters_winter', label: "Pulls d'hiver" },
              { id: 'men_clothing_sweaters_jackets', label: 'Vestes' },
              { id: 'men_clothing_sweaters_other', label: 'Autres' },
            ]
          },
          {
            id: 'men_clothing_pants',
            label: 'Pantalons',
            children: [
              { id: 'men_clothing_pants_chinos', label: 'Chinos' },
              { id: 'men_clothing_pants_joggers', label: 'Jogging' },
              { id: 'men_clothing_pants_skinny', label: 'Pantalons skinny' },
              { id: 'men_clothing_pants_cropped', label: 'Pantacourts' },
              { id: 'men_clothing_pants_dress', label: 'Pantalons de costume' },
              { id: 'men_clothing_pants_wide', label: 'Pantalons à jambes larges' },
              { id: 'men_clothing_pants_other', label: 'Autres pantalons' },
            ]
          },
          {
            id: 'men_clothing_shorts',
            label: 'Shorts',
            children: [
              { id: 'men_clothing_shorts_cargo', label: 'Shorts cargo' },
              { id: 'men_clothing_shorts_chino', label: 'Shorts chino' },
              { id: 'men_clothing_shorts_denim', label: 'Shorts en jean' },
              { id: 'men_clothing_shorts_other', label: 'Autres shorts' },
            ]
          },
          {
            id: 'men_clothing_underwear',
            label: 'Sous-vêtements et chaussettes',
            children: [
              { id: 'men_clothing_underwear_underwear', label: 'Sous-vêtements' },
              { id: 'men_clothing_underwear_socks', label: 'Chaussettes' },
              { id: 'men_clothing_underwear_robes', label: 'Peignoirs' },
              { id: 'men_clothing_underwear_other', label: 'Autres' },
            ]
          },
          {
            id: 'men_clothing_sleepwear',
            label: 'Pyjamas',
            children: [
              { id: 'men_clothing_sleepwear_onepiece', label: 'Pyjamas une-pièce' },
              { id: 'men_clothing_sleepwear_bottoms', label: 'Bas de pyjama' },
              { id: 'men_clothing_sleepwear_sets', label: 'Ensembles de pyjamas' },
              { id: 'men_clothing_sleepwear_tops', label: 'Hauts de pyjama' },
            ]
          },
          { id: 'men_clothing_swimwear', label: 'Maillots de bain' },
          {
            id: 'men_clothing_sport',
            label: 'Vêtements de sport et accessoires',
            children: [
              { id: 'men_clothing_sport_outerwear', label: "Vêtements d'extérieur" },
              { id: 'men_clothing_sport_tracksuits', label: 'Survêtements' },
              { id: 'men_clothing_sport_pants', label: 'Pantalons' },
              { id: 'men_clothing_sport_shorts', label: 'Shorts' },
              { id: 'men_clothing_sport_tops', label: 'Hauts et t-shirts' },
              { id: 'men_clothing_sport_jerseys', label: 'Maillots' },
              { id: 'men_clothing_sport_hoodies', label: 'Pulls & sweats' },
              {
                id: 'men_clothing_sport_accessories',
                label: 'Accessoires de sports',
                children: [
                  { id: 'men_clothing_sport_accessories_eyewear', label: 'Lunettes' },
                  { id: 'men_clothing_sport_accessories_gloves', label: 'Gants' },
                  { id: 'men_clothing_sport_accessories_hats', label: 'Chapeaux et casquettes' },
                  { id: 'men_clothing_sport_accessories_scarves', label: 'Écharpes' },
                  { id: 'men_clothing_sport_accessories_wristbands', label: 'Bracelets' },
                ]
              },
              { id: 'men_clothing_sport_other', label: 'Autres' },
            ]
          },
          { id: 'men_clothing_costumes', label: 'Vêtements spécialisés et costumes' },
          { id: 'men_clothing_other', label: 'Autres' },
        ]
      },
      { id: 'men_shoes', label: 'Chaussures' },
      { id: 'men_accessories', label: 'Accessoires' },
      { id: 'men_grooming', label: 'Soins' },
    ]
  },
  {
    id: 'kids',
    label: 'Enfants',
    icon: 'happy',
    children: [
      {
        id: 'kids_girls',
        label: 'Vêtements pour filles',
        children: [
          {
            id: 'kids_girls_baby',
            label: 'Bébé filles',
            children: [
              { id: 'kids_girls_baby_onesies', label: 'Combinaisons' },
              { id: 'kids_girls_baby_bodysuits', label: 'Bodies' },
              { id: 'kids_girls_baby_sleepers', label: 'Grenouillères' },
              { id: 'kids_girls_baby_sets', label: 'Ensembles' },
              { id: 'kids_girls_baby_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_girls_shoes',
            label: 'Chaussures',
            children: [
              { id: 'kids_girls_shoes_baby', label: 'Chaussures bébé' },
              {
                id: 'kids_girls_shoes_boots',
                label: 'Bottes',
                children: [
                  { id: 'kids_girls_shoes_boots_ankle', label: 'Bottines' },
                  { id: 'kids_girls_shoes_boots_mid', label: 'Bottes mi-hautes' },
                  { id: 'kids_girls_shoes_boots_snow', label: 'Bottes de neige' },
                  { id: 'kids_girls_shoes_boots_rain', label: 'Bottes de pluie' },
                ]
              },
              { id: 'kids_girls_shoes_mules', label: 'Mules et sabots' },
              {
                id: 'kids_girls_shoes_flats',
                label: 'Chaussures plates',
                children: [
                  { id: 'kids_girls_shoes_flats_ballet', label: 'Ballerines, babies et Mary-Jane' },
                  { id: 'kids_girls_shoes_flats_espadrilles', label: 'Espadrilles' },
                  { id: 'kids_girls_shoes_flats_laceups', label: 'Chaussures à lacets' },
                ]
              },
              {
                id: 'kids_girls_shoes_sandals',
                label: 'Sandales, claquettes et tongs',
                children: [
                  { id: 'kids_girls_shoes_sandals_flipflops', label: 'Tongs' },
                  { id: 'kids_girls_shoes_sandals_sandals', label: 'Sandales' },
                  { id: 'kids_girls_shoes_sandals_slides', label: 'Claquettes' },
                ]
              },
              { id: 'kids_girls_shoes_dress', label: 'Chaussures habillées' },
              { id: 'kids_girls_shoes_heels', label: 'Chaussures à talons' },
              { id: 'kids_girls_shoes_slippers', label: 'Chaussons et pantoufles' },
              {
                id: 'kids_girls_shoes_sport',
                label: 'Chaussures de sport',
                children: [
                  { id: 'kids_girls_shoes_sport_basketball', label: 'Chaussures de basket' },
                  { id: 'kids_girls_shoes_sport_dance', label: 'Chaussures de danse' },
                  { id: 'kids_girls_shoes_sport_football', label: 'Chaussures de foot' },
                  { id: 'kids_girls_shoes_sport_hiking', label: 'Chaussures et bottes de randonnée' },
                  { id: 'kids_girls_shoes_sport_iceskating', label: 'Patins à glace' },
                  { id: 'kids_girls_shoes_sport_skating', label: 'Patins à roulettes et rollers' },
                  { id: 'kids_girls_shoes_sport_running', label: 'Chaussures de course' },
                  { id: 'kids_girls_shoes_sport_ski', label: 'Chaussures de ski' },
                  { id: 'kids_girls_shoes_sport_snowboard', label: 'Bottes de snowboard' },
                  { id: 'kids_girls_shoes_sport_water', label: 'Chaussures aquatiques' },
                ]
              },
              {
                id: 'kids_girls_shoes_sneakers',
                label: 'Baskets',
                children: [
                  { id: 'kids_girls_shoes_sneakers_velcro', label: 'Baskets à scratch' },
                  { id: 'kids_girls_shoes_sneakers_laces', label: 'Baskets à lacets' },
                  { id: 'kids_girls_shoes_sneakers_slipon', label: 'Baskets sans lacets' },
                ]
              },
            ]
          },
          {
            id: 'kids_girls_outerwear',
            label: "Vêtements d'extérieur",
            children: [
              {
                id: 'kids_girls_outerwear_coats',
                label: 'Manteaux',
                children: [
                  { id: 'kids_girls_outerwear_coats_duffle', label: 'Duffle-coats' },
                  { id: 'kids_girls_outerwear_coats_parkas', label: 'Parkas' },
                  { id: 'kids_girls_outerwear_coats_peacoats', label: 'Cabans' },
                  { id: 'kids_girls_outerwear_coats_trench', label: 'Trenchs' },
                ]
              },
              { id: 'kids_girls_outerwear_vests', label: 'Vestes sans manches' },
              {
                id: 'kids_girls_outerwear_jackets',
                label: 'Vestes',
                children: [
                  { id: 'kids_girls_outerwear_jackets_blazers', label: 'Blazers' },
                  { id: 'kids_girls_outerwear_jackets_bomber', label: 'Blousons aviateur' },
                  { id: 'kids_girls_outerwear_jackets_denim', label: 'Vestes en jean' },
                  { id: 'kids_girls_outerwear_jackets_fleece', label: 'Vestes polaires' },
                  { id: 'kids_girls_outerwear_jackets_puffer', label: 'Doudounes' },
                  { id: 'kids_girls_outerwear_jackets_windbreaker', label: 'Vestes coupe-vent' },
                ]
              },
              {
                id: 'kids_girls_outerwear_rain',
                label: 'Vêtements de pluie',
                children: [
                  { id: 'kids_girls_outerwear_rain_ponchos', label: 'Ponchos' },
                  { id: 'kids_girls_outerwear_rain_suits', label: 'Combinaisons de pluie' },
                  { id: 'kids_girls_outerwear_rain_pants', label: 'Pantalons de pluie' },
                  { id: 'kids_girls_outerwear_rain_raincoats', label: 'Imperméables' },
                ]
              },
              {
                id: 'kids_girls_outerwear_ski',
                label: 'Vêtements de ski',
                children: [
                  { id: 'kids_girls_outerwear_ski_jackets', label: 'Manteaux et vestes de ski' },
                  { id: 'kids_girls_outerwear_ski_suits', label: 'Combinaisons de ski' },
                  { id: 'kids_girls_outerwear_ski_pants', label: 'Pantalons de ski' },
                ]
              },
            ]
          },
          {
            id: 'kids_girls_sweaters',
            label: 'Pulls & sweats',
            children: [
              { id: 'kids_girls_sweaters_pullovers', label: 'Pulls' },
              { id: 'kids_girls_sweaters_vneck', label: 'Pulls col V' },
              { id: 'kids_girls_sweaters_turtleneck', label: 'Pulls à col roulé' },
              { id: 'kids_girls_sweaters_zip', label: 'Gilets zippés' },
              { id: 'kids_girls_sweaters_boleros', label: 'Boléros' },
              { id: 'kids_girls_sweaters_hoodies', label: 'Pulls à capuche & sweatshirts' },
              { id: 'kids_girls_sweaters_vests', label: 'Gilets' },
              { id: 'kids_girls_sweaters_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_girls_tops',
            label: 'Chemises et t-shirts',
            children: [
              { id: 'kids_girls_tops_tshirts', label: 'T-shirts' },
              { id: 'kids_girls_tops_polos', label: 'Polos' },
              { id: 'kids_girls_tops_shirts', label: 'Chemises' },
              { id: 'kids_girls_tops_shortsleeve', label: 'Chemises manches courtes' },
              { id: 'kids_girls_tops_longsleeve', label: 'Chemises manches longues' },
              { id: 'kids_girls_tops_sleeveless', label: 'Chemises sans manches' },
              { id: 'kids_girls_tops_tunics', label: 'Tuniques' },
              { id: 'kids_girls_tops_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_girls_dresses',
            label: 'Robes',
            children: [
              { id: 'kids_girls_dresses_short', label: 'Robes courtes' },
              { id: 'kids_girls_dresses_long', label: 'Robes longues' },
            ]
          },
          {
            id: 'kids_girls_bottoms',
            label: 'Pantalons et shorts',
            children: [
              { id: 'kids_girls_bottoms_jeans', label: 'Jeans' },
              { id: 'kids_girls_bottoms_slim', label: 'Jeans slim' },
              { id: 'kids_girls_bottoms_flare', label: 'Pantalons pattes d\'éléphant' },
              { id: 'kids_girls_bottoms_leggings', label: 'Leggings' },
              { id: 'kids_girls_bottoms_overalls', label: 'Salopettes' },
              { id: 'kids_girls_bottoms_shorts', label: 'Shorts et pantacourts' },
              { id: 'kids_girls_bottoms_harem', label: 'Sarouels' },
              { id: 'kids_girls_bottoms_other', label: 'Autres' },
            ]
          },
          { id: 'kids_girls_bags', label: 'Sacs et sacs à dos' },
          {
            id: 'kids_girls_accessories',
            label: 'Accessoires',
            children: [
              { id: 'kids_girls_accessories_hats', label: 'Casquettes et chapeaux' },
              { id: 'kids_girls_accessories_gloves', label: 'Gants' },
              { id: 'kids_girls_accessories_scarves', label: 'Écharpes et châles' },
              { id: 'kids_girls_accessories_belts', label: 'Ceintures' },
              { id: 'kids_girls_accessories_hair', label: 'Bandeaux et barrettes cheveux' },
              { id: 'kids_girls_accessories_wallets', label: 'Porte-monnaie' },
              { id: 'kids_girls_accessories_jewelry', label: 'Bijoux' },
              { id: 'kids_girls_accessories_other', label: 'Autres accessoires' },
            ]
          },
          {
            id: 'kids_girls_swimwear',
            label: 'Équipements de natation',
            children: [
              { id: 'kids_girls_swimwear_onepiece', label: 'Maillot de bain 1 pièce' },
              { id: 'kids_girls_swimwear_twopiece', label: 'Maillot de bain 2 pièces' },
              { id: 'kids_girls_swimwear_robes', label: 'Peignoirs' },
            ]
          },
          {
            id: 'kids_girls_underwear',
            label: 'Sous-vêtements',
            children: [
              { id: 'kids_girls_underwear_socks', label: 'Chaussettes' },
              { id: 'kids_girls_underwear_tights', label: 'Collants' },
              { id: 'kids_girls_underwear_panties', label: 'Culottes' },
              { id: 'kids_girls_underwear_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_girls_sleepwear',
            label: 'Pyjamas et chemises de nuit',
            children: [
              { id: 'kids_girls_sleepwear_onepiece', label: 'Pyjamas une pièce' },
              { id: 'kids_girls_sleepwear_twopiece', label: 'Pyjamas deux pièces' },
              { id: 'kids_girls_sleepwear_nightgowns', label: 'Chemises de nuit' },
            ]
          },
        ]
      },
      {
        id: 'kids_boys',
        label: 'Vêtements pour garçons',
        children: [
          {
            id: 'kids_boys_baby',
            label: 'Bébé garçons',
            children: [
              { id: 'kids_boys_baby_onesies', label: 'Combinaisons' },
              { id: 'kids_boys_baby_bodysuits', label: 'Bodies' },
              { id: 'kids_boys_baby_sleepers', label: 'Grenouillères' },
              { id: 'kids_boys_baby_sets', label: 'Ensembles' },
              { id: 'kids_boys_baby_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_boys_shoes',
            label: 'Chaussures',
            children: [
              { id: 'kids_boys_shoes_baby', label: 'Chaussures bébé' },
              { id: 'kids_boys_shoes_loafers', label: 'Mocassins et chaussures bateau' },
              {
                id: 'kids_boys_shoes_boots',
                label: 'Bottes',
                children: [
                  { id: 'kids_boys_shoes_boots_ankle', label: 'Bottines' },
                  { id: 'kids_boys_shoes_boots_mid', label: 'Bottes mi-hautes' },
                  { id: 'kids_boys_shoes_boots_snow', label: 'Bottes de neige' },
                  { id: 'kids_boys_shoes_boots_rain', label: 'Bottes de pluie' },
                ]
              },
              { id: 'kids_boys_shoes_espadrilles', label: 'Espadrilles' },
              {
                id: 'kids_boys_shoes_sandals',
                label: 'Sandales, claquettes et tongs',
                children: [
                  { id: 'kids_boys_shoes_sandals_mules', label: 'Mules et sabots' },
                  { id: 'kids_boys_shoes_sandals_flipflops', label: 'Tongs' },
                  { id: 'kids_boys_shoes_sandals_sandals', label: 'Sandales' },
                  { id: 'kids_boys_shoes_sandals_slides', label: 'Claquettes' },
                ]
              },
              { id: 'kids_boys_shoes_dress', label: 'Chaussures habillées' },
              { id: 'kids_boys_shoes_slippers', label: 'Chaussons et pantoufles' },
              {
                id: 'kids_boys_shoes_sport',
                label: 'Chaussures de sport',
                children: [
                  { id: 'kids_boys_shoes_sport_basketball', label: 'Chaussures de basket' },
                  { id: 'kids_boys_shoes_sport_dance', label: 'Chaussures de danse' },
                  { id: 'kids_boys_shoes_sport_football', label: 'Chaussures de foot' },
                  { id: 'kids_boys_shoes_sport_hiking', label: 'Chaussures et bottes de randonnée' },
                  { id: 'kids_boys_shoes_sport_iceskating', label: 'Patins à glace' },
                  { id: 'kids_boys_shoes_sport_skating', label: 'Patins à roulettes et rollers' },
                  { id: 'kids_boys_shoes_sport_running', label: 'Chaussures de course' },
                  { id: 'kids_boys_shoes_sport_ski', label: 'Chaussures de ski' },
                  { id: 'kids_boys_shoes_sport_snowboard', label: 'Bottes de snowboard' },
                  { id: 'kids_boys_shoes_sport_water', label: 'Chaussures aquatiques' },
                ]
              },
              {
                id: 'kids_boys_shoes_sneakers',
                label: 'Baskets',
                children: [
                  { id: 'kids_boys_shoes_sneakers_velcro', label: 'Baskets à scratch' },
                  { id: 'kids_boys_shoes_sneakers_laces', label: 'Baskets à lacets' },
                  { id: 'kids_boys_shoes_sneakers_slipon', label: 'Baskets sans lacets' },
                ]
              },
            ]
          },
          {
            id: 'kids_boys_outerwear',
            label: "Vêtements d'extérieur",
            children: [
              {
                id: 'kids_boys_outerwear_coats',
                label: 'Manteaux',
                children: [
                  { id: 'kids_boys_outerwear_coats_duffle', label: 'Duffle-coats' },
                  { id: 'kids_boys_outerwear_coats_parkas', label: 'Parkas' },
                  { id: 'kids_boys_outerwear_coats_peacoats', label: 'Cabans' },
                  { id: 'kids_boys_outerwear_coats_trench', label: 'Trenchs' },
                ]
              },
              { id: 'kids_boys_outerwear_vests', label: 'Vestes sans manches' },
              {
                id: 'kids_boys_outerwear_jackets',
                label: 'Vestes',
                children: [
                  { id: 'kids_boys_outerwear_jackets_blazers', label: 'Blazers' },
                  { id: 'kids_boys_outerwear_jackets_bomber', label: 'Blousons aviateur' },
                  { id: 'kids_boys_outerwear_jackets_denim', label: 'Vestes en jean' },
                  { id: 'kids_boys_outerwear_jackets_fleece', label: 'Vestes polaires' },
                  { id: 'kids_boys_outerwear_jackets_puffer', label: 'Doudounes' },
                  { id: 'kids_boys_outerwear_jackets_windbreaker', label: 'Vestes coupe-vent' },
                ]
              },
              {
                id: 'kids_boys_outerwear_rain',
                label: 'Vêtements de pluie',
                children: [
                  { id: 'kids_boys_outerwear_rain_ponchos', label: 'Ponchos' },
                  { id: 'kids_boys_outerwear_rain_suits', label: 'Combinaisons de pluie' },
                  { id: 'kids_boys_outerwear_rain_pants', label: 'Pantalons de pluie' },
                  { id: 'kids_boys_outerwear_rain_raincoats', label: 'Imperméables' },
                ]
              },
              {
                id: 'kids_boys_outerwear_ski',
                label: 'Vêtements de ski',
                children: [
                  { id: 'kids_boys_outerwear_ski_jackets', label: 'Manteaux et vestes de ski' },
                  { id: 'kids_boys_outerwear_ski_suits', label: 'Combinaisons de ski' },
                  { id: 'kids_boys_outerwear_ski_pants', label: 'Pantalons de ski' },
                ]
              },
            ]
          },
          {
            id: 'kids_boys_sweaters',
            label: 'Pulls & sweats',
            children: [
              { id: 'kids_boys_sweaters_pullovers', label: 'Pulls' },
              { id: 'kids_boys_sweaters_vneck', label: 'Pulls col V' },
              { id: 'kids_boys_sweaters_turtleneck', label: 'Pulls à col roulé' },
              { id: 'kids_boys_sweaters_zip', label: 'Gilets zippés' },
              { id: 'kids_boys_sweaters_hoodies', label: 'Pulls à capuche & sweatshirts' },
              { id: 'kids_boys_sweaters_vests', label: 'Gilets' },
              { id: 'kids_boys_sweaters_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_boys_tops',
            label: 'Chemises et t-shirts',
            children: [
              { id: 'kids_boys_tops_tshirts', label: 'T-shirts' },
              { id: 'kids_boys_tops_polos', label: 'Polos' },
              { id: 'kids_boys_tops_shirts', label: 'Chemises' },
              { id: 'kids_boys_tops_shortsleeve', label: 'Chemises manches courtes' },
              { id: 'kids_boys_tops_longsleeve', label: 'Chemises manches longues' },
              { id: 'kids_boys_tops_sleeveless', label: 'Chemises sans manches' },
              { id: 'kids_boys_tops_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_boys_bottoms',
            label: 'Pantalons et shorts',
            children: [
              { id: 'kids_boys_bottoms_jeans', label: 'Jeans' },
              { id: 'kids_boys_bottoms_slim', label: 'Jeans slim' },
              { id: 'kids_boys_bottoms_flare', label: 'Pantalons pattes d\'éléphant' },
              { id: 'kids_boys_bottoms_leggings', label: 'Leggings' },
              { id: 'kids_boys_bottoms_overalls', label: 'Salopettes' },
              { id: 'kids_boys_bottoms_shorts', label: 'Shorts et pantacourts' },
              { id: 'kids_boys_bottoms_harem', label: 'Sarouels' },
              { id: 'kids_boys_bottoms_other', label: 'Autres' },
            ]
          },
          { id: 'kids_boys_bags', label: 'Sacs et sacs à dos' },
          {
            id: 'kids_boys_accessories',
            label: 'Accessoires',
            children: [
              { id: 'kids_boys_accessories_hats', label: 'Casquettes et chapeaux' },
              { id: 'kids_boys_accessories_gloves', label: 'Gants' },
              { id: 'kids_boys_accessories_scarves', label: 'Écharpes et châles' },
              { id: 'kids_boys_accessories_belts', label: 'Ceintures' },
              { id: 'kids_boys_accessories_wallets', label: 'Porte-monnaie' },
              { id: 'kids_boys_accessories_ties', label: 'Noeuds papillon et cravattes' },
              { id: 'kids_boys_accessories_other', label: 'Autres accessoires' },
            ]
          },
          {
            id: 'kids_boys_swimwear',
            label: 'Équipements de natation',
            children: [
              { id: 'kids_boys_swimwear_trunks', label: 'Maillots de bain' },
              { id: 'kids_boys_swimwear_robes', label: 'Peignoirs' },
            ]
          },
          {
            id: 'kids_boys_underwear',
            label: 'Sous-vêtements',
            children: [
              { id: 'kids_boys_underwear_socks', label: 'Chaussettes' },
              { id: 'kids_boys_underwear_tights', label: 'Collants' },
              { id: 'kids_boys_underwear_briefs', label: 'Culottes' },
              { id: 'kids_boys_underwear_other', label: 'Autre' },
            ]
          },
          {
            id: 'kids_boys_sleepwear',
            label: 'Pyjamas',
            children: [
              { id: 'kids_boys_sleepwear_onepiece', label: 'Pyjamas une pièce' },
              { id: 'kids_boys_sleepwear_twopiece', label: 'Pyjamas deux pièces' },
            ]
          },
        ]
      },
      {
        id: 'kids_toys',
        label: 'Jeux et jouets',
        children: [
          {
            id: 'kids_toys_figures',
            label: 'Figurines et accessoires',
            children: [
              { id: 'kids_toys_figures_figures', label: 'Figurines' },
              { id: 'kids_toys_figures_accessories', label: 'Accessoires' },
              { id: 'kids_toys_figures_playsets', label: 'Sets de jeux' },
            ]
          },
          {
            id: 'kids_toys_crafts',
            label: 'Loisirs créatifs',
            children: [
              { id: 'kids_toys_crafts_aprons', label: 'Tabliers et blouses' },
              { id: 'kids_toys_crafts_beads', label: 'Perles et fabrication de bijoux' },
              { id: 'kids_toys_crafts_clay', label: 'Argile et pâte à modeler' },
              { id: 'kids_toys_crafts_kits', label: 'Kits créatifs' },
              { id: 'kids_toys_crafts_painting', label: 'Peinture et dessin' },
              { id: 'kids_toys_crafts_boards', label: 'Tableaux et ardoises' },
              { id: 'kids_toys_crafts_stamps', label: 'Pochoirs et tampons' },
              { id: 'kids_toys_crafts_stickers', label: 'Gommettes et accessoires de papeterie' },
            ]
          },
          {
            id: 'kids_toys_baby',
            label: 'Activités et jouets pour bébé',
            children: [
              { id: 'kids_toys_baby_walkers', label: "Centres d'activités et trotteurs" },
              { id: 'kids_toys_baby_playmats', label: "Tapis d'éveil et d'activités" },
              { id: 'kids_toys_baby_bath', label: 'Jouets de bain' },
              { id: 'kids_toys_baby_bouncers', label: 'Bouncers, jumpers & swings' },
              { id: 'kids_toys_baby_busyboards', label: "Planches d'activités" },
              { id: 'kids_toys_baby_pushpull', label: 'Push & pull toys' },
              { id: 'kids_toys_baby_rattles', label: 'Hochets' },
              { id: 'kids_toys_baby_stacking', label: 'Sorting & stacking toys' },
              { id: 'kids_toys_baby_teething', label: 'Jouets de dentition' },
            ]
          },
          { id: 'kids_toys_building', label: 'Jeux de construction' },
          {
            id: 'kids_toys_dolls',
            label: 'Poupées, poupons et accessoires',
            children: [
              { id: 'kids_toys_dolls_dolls', label: 'Poupées et poupons' },
              { id: 'kids_toys_dolls_accessories', label: 'Accessoires pour poupée et poupon' },
              { id: 'kids_toys_dolls_furniture', label: 'Meubles et accessoires pour maison de poupée' },
              { id: 'kids_toys_dolls_houses', label: 'Maisons de poupées' },
              { id: 'kids_toys_dolls_playsets', label: 'Kits de jeu pour poupée et poupon' },
            ]
          },
          {
            id: 'kids_toys_costumes',
            label: 'Déguisements et jeux de rôle',
            children: [
              { id: 'kids_toys_costumes_costumes', label: 'Déguisements' },
              { id: 'kids_toys_costumes_tents', label: 'Tentes et tunnels de jeux' },
              { id: 'kids_toys_costumes_food', label: 'Toy food, cookware, & dishes' },
              { id: 'kids_toys_costumes_jewelry', label: 'Boîtes à bijoux pour enfant' },
              { id: 'kids_toys_costumes_kitchens', label: 'Cuisines pour enfant' },
              { id: 'kids_toys_costumes_tools', label: 'Matériel de bricolage pour enfant' },
            ]
          },
          {
            id: 'kids_toys_educational',
            label: 'Jeux éducatifs',
            children: [
              { id: 'kids_toys_educational_flashcards', label: 'Cartes flash' },
              { id: 'kids_toys_educational_kaleidoscopes', label: 'Kaléidoscopes et prismes' },
              { id: 'kids_toys_educational_reading', label: "Jeux de lecture et d'écriture" },
              { id: 'kids_toys_educational_stem', label: 'Jeux scientifiques et STEM' },
              { id: 'kids_toys_educational_other', label: 'Autres jeux éducatifs' },
            ]
          },
          {
            id: 'kids_toys_electronic',
            label: 'Jeux et jouets électroniques',
            children: [
              { id: 'kids_toys_electronic_music', label: 'Musiques et histoires' },
              { id: 'kids_toys_electronic_plush', label: 'Peluches interactives' },
              { id: 'kids_toys_electronic_karaoke', label: 'Équipements de karaoké pour enfants' },
              { id: 'kids_toys_electronic_musicboxes', label: 'Boîtes à musique et histoires' },
              { id: 'kids_toys_electronic_remote', label: 'Jouets télécommandés' },
              { id: 'kids_toys_electronic_cameras', label: 'Appareils photo pour enfant' },
              { id: 'kids_toys_electronic_walkietalkies', label: 'Talkies-walkies' },
              { id: 'kids_toys_electronic_other', label: 'Autres jeux et jouets électroniques' },
            ]
          },
          { id: 'kids_toys_musical', label: 'Jeux/jouets musicaux et instruments' },
          {
            id: 'kids_toys_novelty',
            label: 'Jeux de cirque, fidgets et gadgets',
            children: [
              { id: 'kids_toys_novelty_fidgets', label: 'Fidgets' },
              { id: 'kids_toys_novelty_juggling', label: 'Kits de jonglage' },
              { id: 'kids_toys_novelty_magic', label: 'Coffrets et accessoires de magie' },
              { id: 'kids_toys_novelty_pranks', label: 'Farces et attrapes' },
              { id: 'kids_toys_novelty_slime', label: 'Slime & putty' },
              { id: 'kids_toys_novelty_yoyos', label: 'Yoyos' },
              { id: 'kids_toys_novelty_other', label: 'Autres jeux fantaisie et gadgets' },
            ]
          },
          {
            id: 'kids_toys_outdoor',
            label: 'Jeux de sport et de plein air',
            children: [
              { id: 'kids_toys_outdoor_ballpits', label: 'Piscines à balles et accessoires' },
              { id: 'kids_toys_outdoor_water', label: "Jeux d'eau et de plage" },
              { id: 'kids_toys_outdoor_bubbles', label: 'Machines et flacons à bulles' },
              { id: 'kids_toys_outdoor_foam', label: 'Pistolets à projectiles en mousse et accessoires' },
              { id: 'kids_toys_outdoor_other', label: 'Autres jeux de plein air' },
              { id: 'kids_toys_outdoor_kites', label: 'Cerfs-volants et fusées' },
              { id: 'kids_toys_outdoor_sand', label: "Jeux de sable et d'eau" },
              { id: 'kids_toys_outdoor_sports', label: 'Jeux de sport' },
            ]
          },
          { id: 'kids_toys_plush', label: 'Peluches' },
          {
            id: 'kids_toys_vehicles',
            label: 'Voitures, trains et autres véhicules',
            children: [
              { id: 'kids_toys_vehicles_planes', label: 'Avions' },
              { id: 'kids_toys_vehicles_cars', label: 'Voitures' },
              { id: 'kids_toys_vehicles_trains', label: 'Trains' },
              { id: 'kids_toys_vehicles_trucks', label: 'Camions' },
              { id: 'kids_toys_vehicles_tracks', label: 'Circuits et garages' },
              { id: 'kids_toys_vehicles_other', label: 'Autres véhicules' },
            ]
          },
        ]
      },
      {
        id: 'kids_nursery',
        label: 'Puériculture',
        children: [
          {
            id: 'kids_nursery_travel',
            label: 'Poussettes, porte-bébé et sièges auto',
            children: [
              {
                id: 'kids_nursery_travel_carriers',
                label: 'Porte-bébé et écharpes',
                children: [
                  { id: 'kids_nursery_travel_carriers_slings', label: 'Slings et écharpes' },
                  { id: 'kids_nursery_travel_carriers_soft', label: 'Porte-bébé souples' },
                  { id: 'kids_nursery_travel_carriers_hip', label: 'Porte-bébé de hanche' },
                  { id: 'kids_nursery_travel_carriers_backpack', label: 'Backpack carriers' },
                ]
              },
              { id: 'kids_nursery_travel_strollers', label: 'Poussettes et landaus' },
              {
                id: 'kids_nursery_travel_stroller_accessories',
                label: 'Accessoires de poussette',
                children: [
                  { id: 'kids_nursery_travel_stroller_accessories_bassinets', label: 'Nacelles, cosys et adaptateurs' },
                  { id: 'kids_nursery_travel_stroller_accessories_boards', label: 'Planches à roulettes et sièges supplémentaires' },
                  { id: 'kids_nursery_travel_stroller_accessories_covers', label: 'Habillages pluie, capotes et ombrelles' },
                  { id: 'kids_nursery_travel_stroller_accessories_cupholders', label: 'Porte-gobelet et plateaux' },
                  { id: 'kids_nursery_travel_stroller_accessories_footmuffs', label: 'Chancelières pour poussette' },
                  { id: 'kids_nursery_travel_stroller_accessories_organizers', label: 'Organisateurs et filets' },
                  { id: 'kids_nursery_travel_stroller_accessories_parts', label: 'Pièces détachées' },
                ]
              },
              { id: 'kids_nursery_travel_carseats', label: 'Sièges auto' },
              { id: 'kids_nursery_travel_boosters', label: 'Rehausseurs' },
              {
                id: 'kids_nursery_travel_carseat_accessories',
                label: 'Accessoires pour siège auto',
                children: [
                  { id: 'kids_nursery_travel_carseat_accessories_mirrors', label: 'Miroirs de voiture' },
                  { id: 'kids_nursery_travel_carseat_accessories_shades', label: 'Car sun shades & screens' },
                  { id: 'kids_nursery_travel_carseat_accessories_inserts', label: 'Réducteurs pour siège auto' },
                  { id: 'kids_nursery_travel_carseat_accessories_bases', label: 'Car seat bases' },
                  { id: 'kids_nursery_travel_carseat_accessories_covers', label: 'Housses pour siège auto' },
                  { id: 'kids_nursery_travel_carseat_accessories_footmuffs', label: 'Car seat footmuffs' },
                  { id: 'kids_nursery_travel_carseat_accessories_other', label: 'Autres accessoires pour voiture' },
                ]
              },
            ]
          },
          {
            id: 'kids_nursery_furniture',
            label: 'Meubles et décoration',
            children: [
              {
                id: 'kids_nursery_furniture_mattresses',
                label: 'Matelas pour lits bébé et enfant',
                children: [
                  { id: 'kids_nursery_furniture_mattresses_crib', label: 'Matelas pour lit à barreaux' },
                  { id: 'kids_nursery_furniture_mattresses_bassinet', label: 'Matelas pour berceau' },
                  { id: 'kids_nursery_furniture_mattresses_toddler', label: 'Matelas pour lit enfant' },
                ]
              },
              { id: 'kids_nursery_furniture_floormats', label: 'Tapis de sol et dalles en mousse' },
              { id: 'kids_nursery_furniture_playpens', label: 'Parcs' },
              { id: 'kids_nursery_furniture_nests', label: 'Réducteurs de lit' },
              {
                id: 'kids_nursery_furniture_decor',
                label: 'Décoration et souvenirs',
                children: [
                  { id: 'kids_nursery_furniture_decor_albums', label: 'Albums photo' },
                  { id: 'kids_nursery_furniture_decor_growthcharts', label: 'Toises' },
                  { id: 'kids_nursery_furniture_decor_mobiles', label: 'Mobiles' },
                  { id: 'kids_nursery_furniture_decor_milestones', label: 'Cartes étapes et accessoires photo' },
                  { id: 'kids_nursery_furniture_decor_piggybanks', label: 'Tirelires' },
                  { id: 'kids_nursery_furniture_decor_frames', label: 'Cadres photo' },
                  { id: 'kids_nursery_furniture_decor_wall', label: 'Décorations murales' },
                ]
              },
              {
                id: 'kids_nursery_furniture_bedroom',
                label: 'Chambre de bébé',
                children: [
                  { id: 'kids_nursery_furniture_bedroom_cosleepers', label: 'Cododos' },
                  { id: 'kids_nursery_furniture_bedroom_changingtables', label: 'Tables à langer' },
                  { id: 'kids_nursery_furniture_bedroom_cribs', label: 'Lits à barreaux' },
                  { id: 'kids_nursery_furniture_bedroom_bassinets', label: 'Berceaux' },
                  { id: 'kids_nursery_furniture_bedroom_toddlerbeds', label: 'Lits enfant' },
                ]
              },
              { id: 'kids_nursery_furniture_rugs', label: 'Tapis' },
              { id: 'kids_nursery_furniture_chairs', label: 'Chaises et fauteuils' },
              { id: 'kids_nursery_furniture_climbers', label: 'Modules de motricité' },
              { id: 'kids_nursery_furniture_shelves', label: 'Étagères' },
              { id: 'kids_nursery_furniture_desks', label: 'Tables et bureaux' },
              { id: 'kids_nursery_furniture_wardrobes', label: 'Armoires' },
            ]
          },
          {
            id: 'kids_nursery_bathing',
            label: 'Bain et change',
            children: [
              { id: 'kids_nursery_bathing_diaperbags', label: 'Sacs à langer' },
              {
                id: 'kids_nursery_bathing_bath',
                label: 'Bain',
                children: [
                  { id: 'kids_nursery_bathing_bath_tubs', label: 'Bath tubs & seats' },
                  { id: 'kids_nursery_bathing_bath_accessories', label: 'Accessoires de bain' },
                  { id: 'kids_nursery_bathing_bath_towels', label: 'Serviettes de bain' },
                  { id: 'kids_nursery_bathing_bath_washcloths', label: 'Washcloths' },
                ]
              },
              {
                id: 'kids_nursery_bathing_changing',
                label: 'Changing mats & covers',
                children: [
                  { id: 'kids_nursery_bathing_changing_mats', label: 'Matelas à langer' },
                  { id: 'kids_nursery_bathing_changing_covers', label: 'Housses de matelas à langer' },
                  { id: 'kids_nursery_bathing_changing_portable', label: 'Matelas à langer nomades' },
                ]
              },
              {
                id: 'kids_nursery_bathing_diapers',
                label: 'Couches',
                children: [
                  { id: 'kids_nursery_bathing_diapers_cloth', label: 'Couches lavables' },
                  { id: 'kids_nursery_bathing_diapers_swim', label: 'Couches de bain' },
                  { id: 'kids_nursery_bathing_diapers_disposable', label: 'Couches jetables' },
                ]
              },
              {
                id: 'kids_nursery_bathing_diaperstorage',
                label: 'Poubelles et rangements pour couches',
                children: [
                  { id: 'kids_nursery_bathing_diaperstorage_pails', label: 'Poubelles à couches' },
                  { id: 'kids_nursery_bathing_diaperstorage_pailaccessories', label: 'Accessoires pour poubelles à couches' },
                  { id: 'kids_nursery_bathing_diaperstorage_caddies', label: 'Rangements pour couches' },
                  { id: 'kids_nursery_bathing_diaperstorage_wipes', label: 'Chauffe-lingettes et rangements pour lingettes' },
                ]
              },
              { id: 'kids_nursery_bathing_potty', label: 'Pots et réducteurs' },
              {
                id: 'kids_nursery_bathing_hygiene',
                label: 'Hygiène et soin',
                children: [
                  { id: 'kids_nursery_bathing_hygiene_accessories', label: 'Accessoires de soin' },
                  { id: 'kids_nursery_bathing_hygiene_skincare', label: 'Shampoings, savons et soins pour la peau' },
                  { id: 'kids_nursery_bathing_hygiene_wipes', label: 'Baby wipes' },
                ]
              },
              { id: 'kids_nursery_bathing_stools', label: 'Marchepieds' },
            ]
          },
          {
            id: 'kids_nursery_safety',
            label: 'Sécurité bébé et enfant',
            children: [
              { id: 'kids_nursery_safety_gates', label: 'Barrières de sécurité' },
              { id: 'kids_nursery_safety_accessories', label: 'Accessoires de sécurité' },
              { id: 'kids_nursery_safety_hearing', label: 'Protections auditives' },
              { id: 'kids_nursery_safety_harnesses', label: 'Laisses et harnais' },
            ]
          },
          {
            id: 'kids_nursery_health',
            label: 'Santé et grossesse',
            children: [
              { id: 'kids_nursery_health_humidifiers', label: 'Humidificateurs' },
              { id: 'kids_nursery_health_aspirators', label: 'Mouche-bébé' },
              { id: 'kids_nursery_health_postpartum', label: 'Soins du post-partum' },
              { id: 'kids_nursery_health_pillows', label: 'Coussins de grossesse' },
              { id: 'kids_nursery_health_belts', label: 'Pregnancy support belts' },
              { id: 'kids_nursery_health_scales', label: 'Balances' },
              { id: 'kids_nursery_health_thermometers', label: 'Thermomètres' },
            ]
          },
          {
            id: 'kids_nursery_feeding',
            label: 'Allaitement et alimentation',
            children: [
              { id: 'kids_nursery_feeding_foodmakers', label: 'Mixeurs et robots cuiseurs pour bébé' },
              { id: 'kids_nursery_feeding_bibs', label: 'Bavoirs' },
              {
                id: 'kids_nursery_feeding_bottles',
                label: 'Alimentation au biberon',
                children: [
                  { id: 'kids_nursery_feeding_bottles_bottles', label: 'Biberons' },
                  { id: 'kids_nursery_feeding_bottles_nipples', label: 'Tétines' },
                  { id: 'kids_nursery_feeding_bottles_dryingracks', label: 'Séchoirs à linge' },
                  { id: 'kids_nursery_feeding_bottles_brushes', label: 'Goupillons' },
                  { id: 'kids_nursery_feeding_bottles_warmers', label: 'Chauffe-biberon' },
                  { id: 'kids_nursery_feeding_bottles_makers', label: 'Préparateurs de biberons' },
                  { id: 'kids_nursery_feeding_bottles_dispensers', label: 'Boîtes doseuses' },
                ]
              },
              {
                id: 'kids_nursery_feeding_nursing',
                label: 'Allaitement',
                children: [
                  { id: 'kids_nursery_feeding_nursing_pumps', label: 'Tire-lait' },
                  { id: 'kids_nursery_feeding_nursing_pumpaccessories', label: 'Accessoires pour tire-lait' },
                  { id: 'kids_nursery_feeding_nursing_covers', label: "Couvertures d'allaitement" },
                  { id: 'kids_nursery_feeding_nursing_pads', label: "Coussinets d'allaitement et protège-mamelon" },
                ]
              },
              {
                id: 'kids_nursery_feeding_mealtime',
                label: 'Repas de bébé',
                children: [
                  { id: 'kids_nursery_feeding_mealtime_utensils', label: 'Couverts' },
                  { id: 'kids_nursery_feeding_mealtime_plates', label: 'Assiettes et bols' },
                  { id: 'kids_nursery_feeding_mealtime_sets', label: 'Coffrets repas' },
                  { id: 'kids_nursery_feeding_mealtime_cups', label: "Tasses d'apprentissage" },
                  { id: 'kids_nursery_feeding_mealtime_pouches', label: 'Gourdes' },
                ]
              },
              { id: 'kids_nursery_feeding_pillows', label: "Coussins et couvertures d'allaitement" },
              { id: 'kids_nursery_feeding_pacifiers', label: 'Sucettes' },
              { id: 'kids_nursery_feeding_pacifieraccessories', label: 'Accessoires pour sucettes' },
              { id: 'kids_nursery_feeding_highchairs', label: 'Chaises hautes' },
              { id: 'kids_nursery_feeding_highchairaccessories', label: 'Accessoires pour chaise haute' },
              { id: 'kids_nursery_feeding_burpcloths', label: 'Langes' },
              { id: 'kids_nursery_feeding_sterilizers', label: 'Stérilisateurs' },
            ]
          },
          {
            id: 'kids_nursery_sleep',
            label: 'Sommeil et literie',
            children: [
              { id: 'kids_nursery_sleep_monitors', label: 'Babyphones' },
              { id: 'kids_nursery_sleep_bedrails', label: 'Barrières de lit' },
              {
                id: 'kids_nursery_sleep_bedding',
                label: 'Linge de lit, couvertures et plaids',
                children: [
                  { id: 'kids_nursery_sleep_bedding_blankets', label: 'Couvertures et plaids' },
                  { id: 'kids_nursery_sleep_bedding_sheets', label: 'Draps-housses et alèses' },
                  { id: 'kids_nursery_sleep_bedding_pillows', label: 'Oreillers' },
                  { id: 'kids_nursery_sleep_bedding_flatsheets', label: 'Draps' },
                ]
              },
              { id: 'kids_nursery_sleep_blinds', label: 'Stores occultants' },
              { id: 'kids_nursery_sleep_warmers', label: 'Coussins chauffants et bouillottes' },
              { id: 'kids_nursery_sleep_nightlights', label: 'Veilleuses' },
              { id: 'kids_nursery_sleep_sleepbags', label: 'Gigoteuses et turbulettes' },
              { id: 'kids_nursery_sleep_sleepingsacks', label: 'Sacs de couchage' },
              { id: 'kids_nursery_sleep_swaddles', label: "Couvertures d'emmaillotage" },
              { id: 'kids_nursery_sleep_whitenoise', label: 'Générateurs de bruits blancs' },
            ]
          },
          {
            id: 'kids_nursery_school',
            label: 'Scolaire',
            children: [
              { id: 'kids_nursery_school_lunchboxes', label: 'Boîtes et sacs à repas' },
              { id: 'kids_nursery_school_backpacks', label: 'Cartables' },
              { id: 'kids_nursery_school_supplies', label: 'Fournitures scolaires' },
            ]
          },
        ]
      },
    ]
  },
  // ============================================
  // ÉLECTRONIQUE
  // ============================================
  {
    id: 'electronics',
    label: 'Électronique',
    icon: 'hardware-chip',
    children: [
      {
        id: 'electronics_gaming',
        label: 'Jeux vidéo et consoles',
        children: [
          { id: 'electronics_gaming_all', label: 'Tous' },
          { id: 'electronics_gaming_consoles', label: 'Consoles' },
          { id: 'electronics_gaming_games', label: 'Jeux' },
          { id: 'electronics_gaming_controllers', label: 'Manettes' },
          { id: 'electronics_gaming_headsets', label: 'Casques gaming' },
          { id: 'electronics_gaming_simulators', label: 'Simulateurs' },
          {
            id: 'electronics_gaming_vr',
            label: 'Réalité virtuelle',
            children: [
              { id: 'electronics_gaming_vr_all', label: 'Tous' },
              { id: 'electronics_gaming_vr_headsets', label: 'Casques de réalité virtuelle' },
              { id: 'electronics_gaming_vr_accessories', label: 'Accessoires de réalité virtuelle' },
              { id: 'electronics_gaming_vr_parts', label: 'Pièces de rechange pour appareils de réalité virtuelle' },
            ]
          },
          {
            id: 'electronics_gaming_accessories',
            label: 'Accessoires',
            children: [
              { id: 'electronics_gaming_accessories_all', label: 'Tous' },
              { id: 'electronics_gaming_accessories_cases', label: 'Étuis' },
              { id: 'electronics_gaming_accessories_stands', label: 'Supports gaming' },
              { id: 'electronics_gaming_accessories_chargers', label: "Chargeurs et stations d'accueil gaming" },
              { id: 'electronics_gaming_accessories_guides', label: 'Guides de stratégie de jeu' },
              { id: 'electronics_gaming_accessories_other', label: 'Autres accessoires' },
            ]
          },
        ]
      },
      {
        id: 'electronics_computers',
        label: 'Ordinateurs et accessoires',
        children: [
          { id: 'electronics_computers_all', label: 'Tous' },
          { id: 'electronics_computers_laptops', label: 'Ordinateurs portables' },
          { id: 'electronics_computers_desktops', label: 'Ordinateurs de bureau' },
          {
            id: 'electronics_computers_parts',
            label: 'Pièces détachées et composants informatiques',
            children: [
              { id: 'electronics_computers_parts_all', label: 'Tous' },
              { id: 'electronics_computers_parts_cases', label: 'Boîtiers PC' },
              { id: 'electronics_computers_parts_cpu', label: 'CPU et processeurs' },
              { id: 'electronics_computers_parts_motherboards', label: 'Cartes mères' },
              { id: 'electronics_computers_parts_combos', label: 'Kits carte mère et processeur' },
              { id: 'electronics_computers_parts_gpu', label: 'Cartes graphiques' },
              { id: 'electronics_computers_parts_ram', label: 'Barrettes de RAM' },
              { id: 'electronics_computers_parts_cooling', label: 'Refroidissement et ventilateurs pour ordinateurs' },
              { id: 'electronics_computers_parts_soundcards', label: 'Cartes son internes' },
              { id: 'electronics_computers_parts_capture', label: "Cartes d'acquisition vidéo et tuner TV" },
              { id: 'electronics_computers_parts_storage', label: 'Dispositifs de stockage internes' },
              { id: 'electronics_computers_parts_psu', label: 'Alimentations pour ordinateurs' },
              { id: 'electronics_computers_parts_tools', label: "Outils de réparation d'ordinateurs" },
              { id: 'electronics_computers_parts_laptop', label: 'Pièces de rechange pour ordinateurs portables' },
              { id: 'electronics_computers_parts_other', label: 'Autres composants et pièces de rechange' },
            ]
          },
          {
            id: 'electronics_computers_media',
            label: 'Supports vierges',
            children: [
              { id: 'electronics_computers_media_all', label: 'Tous' },
              { id: 'electronics_computers_media_usb', label: 'Clés USB' },
              { id: 'electronics_computers_media_hdd', label: 'Disques durs externes' },
              { id: 'electronics_computers_media_discs', label: 'Disques CD, DVD et Blu-ray' },
              { id: 'electronics_computers_media_floppy', label: 'Disquettes' },
              { id: 'electronics_computers_media_zip', label: 'Lecteurs Zip et Jaz' },
              { id: 'electronics_computers_media_cases', label: 'Pochettes et étuis pour disques CD, DVD et Blu-ray' },
              { id: 'electronics_computers_media_other', label: 'Autres supports vierges' },
            ]
          },
          {
            id: 'electronics_computers_accessories',
            label: 'Accessoires informatiques',
            children: [
              { id: 'electronics_computers_accessories_all', label: 'Tous' },
              { id: 'electronics_computers_accessories_duplicators', label: 'Duplicateurs de disques durs' },
              { id: 'electronics_computers_accessories_adapters', label: 'Adaptateurs de cartes mémoire' },
              { id: 'electronics_computers_accessories_readers', label: 'Lecteurs de cartes mémoire' },
              { id: 'electronics_computers_accessories_other', label: 'Autres accessoires informatiques' },
            ]
          },
          { id: 'electronics_computers_laptop_accessories', label: 'Accessoires pour ordinateurs portables' },
          { id: 'electronics_computers_docks', label: "Stations d'accueil et concentrateurs USB" },
          {
            id: 'electronics_computers_keyboards',
            label: 'Claviers et accessoires',
            children: [
              { id: 'electronics_computers_keyboards_all', label: 'Tous' },
              { id: 'electronics_computers_keyboards_keyboards', label: 'Claviers' },
              { id: 'electronics_computers_keyboards_switches', label: 'Commutateurs de claviers' },
              { id: 'electronics_computers_keyboards_keycaps', label: 'Touches de clavier' },
              { id: 'electronics_computers_keyboards_stickers', label: 'Autocollants pour claviers' },
              { id: 'electronics_computers_keyboards_covers', label: 'Protège-claviers' },
            ]
          },
          { id: 'electronics_computers_mice', label: 'Souris' },
          { id: 'electronics_computers_mousepads', label: 'Tapis de souris' },
          {
            id: 'electronics_computers_monitors',
            label: 'Moniteurs et accessoires',
            children: [
              { id: 'electronics_computers_monitors_all', label: 'Tous' },
              { id: 'electronics_computers_monitors_monitors', label: 'Moniteurs' },
              { id: 'electronics_computers_monitors_stands', label: 'Supports pour moniteurs' },
              { id: 'electronics_computers_monitors_arms', label: 'Bras pour moniteurs' },
              { id: 'electronics_computers_monitors_privacy', label: 'Filtres de confidentialité pour moniteurs' },
              { id: 'electronics_computers_monitors_protectors', label: 'Protège-moniteurs' },
            ]
          },
          { id: 'electronics_computers_speakers', label: 'Haut-parleurs pour ordinateurs' },
          { id: 'electronics_computers_microphones', label: "Microphones d'ordinateur" },
          { id: 'electronics_computers_webcams', label: 'Webcams' },
          {
            id: 'electronics_computers_network',
            label: 'Équipements réseau',
            children: [
              { id: 'electronics_computers_network_all', label: 'Tous' },
              { id: 'electronics_computers_network_routers', label: 'Routeurs' },
              { id: 'electronics_computers_network_mesh', label: 'Systèmes Mesh' },
              { id: 'electronics_computers_network_repeaters', label: 'Répéteurs réseau' },
              { id: 'electronics_computers_network_modems', label: 'Modems' },
              { id: 'electronics_computers_network_hotspots', label: "Points d'accès mobiles" },
              { id: 'electronics_computers_network_adapters', label: 'Adaptateurs réseau' },
              { id: 'electronics_computers_network_satellite', label: 'Récepteurs Internet par satellite' },
            ]
          },
          {
            id: 'electronics_computers_printers',
            label: 'Imprimantes et accessoires',
            children: [
              { id: 'electronics_computers_printers_all', label: 'Tous' },
              { id: 'electronics_computers_printers_inkjet', label: "Imprimantes à jet d'encre" },
              { id: 'electronics_computers_printers_laser', label: 'Imprimantes laser' },
              { id: 'electronics_computers_printers_photo', label: 'Imprimantes photo' },
              { id: 'electronics_computers_printers_label', label: "Imprimantes d'étiquettes" },
              { id: 'electronics_computers_printers_thermal', label: 'Imprimantes thermiques' },
              { id: 'electronics_computers_printers_multifunction', label: 'Imprimantes multifonctions professionnelles' },
              { id: 'electronics_computers_printers_ink', label: "Cartouches d'encre pour imprimantes" },
              { id: 'electronics_computers_printers_toner', label: 'Toner pour imprimantes' },
              { id: 'electronics_computers_printers_ribbons', label: 'Rubans encreurs' },
              { id: 'electronics_computers_printers_parts', label: 'Pièces de rechange pour imprimantes' },
            ]
          },
          {
            id: 'electronics_computers_scanners',
            label: 'Scanners et accessoires',
            children: [
              { id: 'electronics_computers_scanners_all', label: 'Tous' },
              { id: 'electronics_computers_scanners_scanners', label: 'Scanners' },
              { id: 'electronics_computers_scanners_accessories', label: 'Accessoires pour scanners' },
            ]
          },
          { id: 'electronics_computers_tablets_stylus', label: 'Tablettes tactiles et tablettes à stylets' },
        ]
      },
      {
        id: 'electronics_phones',
        label: 'Téléphones portables et équipements',
        children: [
          {
            id: 'electronics_phones_accessories',
            label: 'Pièces de rechange et accessoires pour smartphones',
            children: [
              { id: 'electronics_phones_accessories_all', label: 'Tous' },
              { id: 'electronics_phones_accessories_cases', label: 'Coques pour téléphones portables' },
              { id: 'electronics_phones_accessories_screenprotectors', label: "Protections d'écran pour téléphones portables" },
              { id: 'electronics_phones_accessories_grips', label: 'Poignées pour téléphones portables' },
              { id: 'electronics_phones_accessories_selfie', label: 'Perches à selfie' },
              { id: 'electronics_phones_accessories_stands', label: 'Supports pour téléphones portables' },
              { id: 'electronics_phones_accessories_lights', label: 'Lampes à selfie et ring lights pour téléphones portables' },
              { id: 'electronics_phones_accessories_charms', label: 'Charms pour téléphones portables' },
              { id: 'electronics_phones_accessories_parts', label: 'Pièces de rechange pour téléphones portables' },
              { id: 'electronics_phones_accessories_other', label: 'Autres accessoires de téléphonie mobile' },
            ]
          },
          {
            id: 'electronics_phones_radio',
            label: 'Communication radio',
            children: [
              { id: 'electronics_phones_radio_all', label: 'Tous' },
              { id: 'electronics_phones_radio_shortwave', label: 'Radios à ondes courtes' },
              { id: 'electronics_phones_radio_walkietalkie', label: 'Talkies-walkies' },
            ]
          },
        ]
      },
      {
        id: 'electronics_audio',
        label: 'Audio, casques et hi-fi',
        children: [
          { id: 'electronics_audio_all', label: 'Tous' },
          { id: 'electronics_audio_headphones', label: 'Casques audio et écouteurs' },
          {
            id: 'electronics_audio_portable',
            label: 'Lecteurs de musique portables',
            children: [
              { id: 'electronics_audio_portable_all', label: 'Tous' },
              { id: 'electronics_audio_portable_mp3', label: 'Lecteurs MP3' },
              { id: 'electronics_audio_portable_cd', label: 'Lecteurs CD portables' },
              { id: 'electronics_audio_portable_cassette', label: 'Lecteurs de cassettes portables' },
              { id: 'electronics_audio_portable_minidisc', label: 'Lecteurs MiniDisc portables' },
            ]
          },
          { id: 'electronics_audio_radios', label: 'Radios portables' },
          { id: 'electronics_audio_speakers_portable', label: 'Enceintes portables' },
          { id: 'electronics_audio_speakers_smart', label: 'Enceintes connectées' },
          {
            id: 'electronics_audio_home',
            label: 'Systèmes audio domestiques',
            children: [
              { id: 'electronics_audio_home_all', label: 'Tous' },
              { id: 'electronics_audio_home_hifi', label: 'Chaînes hi-fi et chaînes stéréo' },
              { id: 'electronics_audio_home_speakers', label: 'Enceintes' },
              { id: 'electronics_audio_home_subwoofers', label: 'Caissons de basses' },
              { id: 'electronics_audio_home_soundbars', label: 'Barres de son' },
              { id: 'electronics_audio_home_equalizers', label: 'Égaliseurs' },
              { id: 'electronics_audio_home_amplifiers', label: 'Amplificateurs et préamplificateurs' },
              { id: 'electronics_audio_home_receivers', label: 'Récepteurs' },
              { id: 'electronics_audio_home_turntables', label: 'Platines vinyle' },
              { id: 'electronics_audio_home_cdplayers', label: 'Lecteurs et graveurs CD' },
              { id: 'electronics_audio_home_cassette', label: 'Lecteurs de cassettes' },
              { id: 'electronics_audio_home_tuners', label: 'Tuners radio' },
              { id: 'electronics_audio_home_minidisc', label: 'Lecteurs et graveurs MiniDisc' },
              { id: 'electronics_audio_home_other', label: 'Autres appareils audio domestiques' },
            ]
          },
          {
            id: 'electronics_audio_accessories',
            label: 'Accessoires pour appareils audio',
            children: [
              { id: 'electronics_audio_accessories_all', label: 'Tous' },
              { id: 'electronics_audio_accessories_headphone_stands', label: 'Supports pour casques' },
              { id: 'electronics_audio_accessories_earpads', label: 'Coussinets pour casques' },
              { id: 'electronics_audio_accessories_eartips', label: "Embouts d'écouteurs" },
              { id: 'electronics_audio_accessories_stylus', label: 'Aiguilles de platines vinyle' },
              { id: 'electronics_audio_accessories_slipmats', label: 'Couvre-plateaux pour platines vinyle' },
              { id: 'electronics_audio_accessories_pads', label: 'Pads isolants pour enceintes et caissons de basses' },
              { id: 'electronics_audio_accessories_other', label: 'Autres accessoires audio' },
            ]
          },
          { id: 'electronics_audio_parts', label: 'Pièces de rechange pour appareils hi-fi et audio' },
        ]
      },
      {
        id: 'electronics_cameras',
        label: 'Appareils photo et accessoires',
        children: [
          { id: 'electronics_cameras_all', label: 'Tous' },
          {
            id: 'electronics_cameras_cameras',
            label: 'Appareils photo',
            children: [
              { id: 'electronics_cameras_cameras_all', label: 'Tous' },
              { id: 'electronics_cameras_cameras_action', label: "Caméras d'action" },
              { id: 'electronics_cameras_cameras_digital', label: 'Appareils photo numériques' },
              { id: 'electronics_cameras_cameras_film', label: 'Appareils photo argentiques' },
              { id: 'electronics_cameras_cameras_instant', label: 'Appareils photo instantanés' },
              { id: 'electronics_cameras_cameras_camcorders', label: 'Caméscopes et caméras' },
              { id: 'electronics_cameras_cameras_other', label: 'Autres appareils photo' },
            ]
          },
          { id: 'electronics_cameras_lenses', label: 'Objectifs' },
          { id: 'electronics_cameras_flashes', label: 'Flashs' },
          { id: 'electronics_cameras_memory', label: 'Cartes mémoire' },
          { id: 'electronics_cameras_tripods', label: 'Trépieds et monopodes' },
          { id: 'electronics_cameras_stabilizers', label: 'Stabilisateurs et supports' },
          {
            id: 'electronics_cameras_darkroom',
            label: 'Équipements pour chambres noires',
            children: [
              { id: 'electronics_cameras_darkroom_all', label: 'Tous' },
              { id: 'electronics_cameras_darkroom_processing', label: 'Équipements de traitement pour chambres noires' },
              { id: 'electronics_cameras_darkroom_safelights', label: 'Lampes inactiniques pour chambres noires' },
              { id: 'electronics_cameras_darkroom_enlargers', label: "Objectifs et équipements d'agrandissement" },
              { id: 'electronics_cameras_darkroom_paper', label: 'Papier photographique' },
              { id: 'electronics_cameras_darkroom_other', label: 'Autres équipements pour chambres noires' },
            ]
          },
          {
            id: 'electronics_cameras_studio',
            label: 'Équipement pour studio',
            children: [
              { id: 'electronics_cameras_studio_all', label: 'Tous' },
              { id: 'electronics_cameras_studio_accessories', label: 'Accessoires pour studio et photobooth' },
              { id: 'electronics_cameras_studio_backdrops', label: 'Fond de studio' },
              { id: 'electronics_cameras_studio_lighting', label: 'Éclairage pour studio' },
            ]
          },
          {
            id: 'electronics_cameras_drones',
            label: 'Drones et accessoires',
            children: [
              { id: 'electronics_cameras_drones_all', label: 'Tous' },
              { id: 'electronics_cameras_drones_drones', label: 'Drones-caméras' },
              { id: 'electronics_cameras_drones_bags', label: 'Sacs pour drones' },
              { id: 'electronics_cameras_drones_parts', label: 'Pièces de rechange pour drones' },
            ]
          },
          {
            id: 'electronics_cameras_accessories',
            label: 'Accessoires',
            children: [
              { id: 'electronics_cameras_accessories_all', label: 'Tous' },
              { id: 'electronics_cameras_accessories_bags', label: 'Étuis et sacs pour appareils photo' },
              { id: 'electronics_cameras_accessories_straps', label: 'Sangles pour appareils photo' },
              { id: 'electronics_cameras_accessories_film', label: 'Pellicule' },
              { id: 'electronics_cameras_accessories_lens', label: 'Accessoires pour objectifs' },
              { id: 'electronics_cameras_accessories_lighting', label: "Accessoires d'éclairage" },
              { id: 'electronics_cameras_accessories_repair', label: 'Kits de réparation pour appareils photo' },
              { id: 'electronics_cameras_accessories_other', label: 'Autres accessoires pour appareils photo' },
            ]
          },
          { id: 'electronics_cameras_parts', label: 'Pièces de rechange pour appareils photo' },
          { id: 'electronics_cameras_other', label: 'Autre matériel de photographie' },
        ]
      },
      {
        id: 'electronics_tablets',
        label: 'Tablettes, liseuses et accessoires',
        children: [
          { id: 'electronics_tablets_all', label: 'Tous' },
          { id: 'electronics_tablets_tablets', label: 'Tablettes' },
          { id: 'electronics_tablets_ereaders', label: 'Liseuses' },
          { id: 'electronics_tablets_notepads', label: 'Blocs-notes numériques' },
          { id: 'electronics_tablets_pda', label: 'Assistants personnels' },
          {
            id: 'electronics_tablets_accessories',
            label: 'Accessoires',
            children: [
              { id: 'electronics_tablets_accessories_all', label: 'Tous' },
              { id: 'electronics_tablets_accessories_tablet_cases', label: 'Étuis et folios pour tablettes' },
              { id: 'electronics_tablets_accessories_ereader_cases', label: 'Étuis et folios pour liseuses' },
              { id: 'electronics_tablets_accessories_keyboards', label: 'Claviers pour tablettes' },
              { id: 'electronics_tablets_accessories_stands', label: 'Supports pour tablettes' },
              { id: 'electronics_tablets_accessories_stylus', label: 'Stylets' },
              { id: 'electronics_tablets_accessories_parts', label: 'Pièces de rechange pour tablettes et liseuses' },
            ]
          },
        ]
      },
      {
        id: 'electronics_tv',
        label: 'TV et home cinema',
        children: [
          { id: 'electronics_tv_all', label: 'Tous' },
          { id: 'electronics_tv_televisions', label: 'Téléviseurs' },
          { id: 'electronics_tv_projectors', label: 'Projecteurs' },
          { id: 'electronics_tv_streamers', label: 'Passerelles multimédias' },
          { id: 'electronics_tv_antennas', label: 'Antennes de télévision' },
          { id: 'electronics_tv_satellite', label: 'Antennes paraboliques' },
          { id: 'electronics_tv_decoders', label: 'Décodeurs vidéo' },
          { id: 'electronics_tv_receivers', label: 'Récepteurs de télévision' },
          { id: 'electronics_tv_homecinema', label: 'Systèmes de home cinema' },
          { id: 'electronics_tv_bluray', label: 'Lecteurs Blu-ray' },
          { id: 'electronics_tv_dvd', label: 'Lecteurs DVD' },
          { id: 'electronics_tv_vcr', label: 'Magnétoscopes' },
          {
            id: 'electronics_tv_other_players',
            label: 'Autres appareils de lecture vidéo',
            children: [
              { id: 'electronics_tv_other_players_all', label: 'Tous' },
              { id: 'electronics_tv_other_players_hddvd', label: 'Lecteurs HD DVD' },
              { id: 'electronics_tv_other_players_laserdisc', label: 'Lecteurs LaserDisc' },
              { id: 'electronics_tv_other_players_video2000', label: 'Lecteurs Vidéo 2000' },
              { id: 'electronics_tv_other_players_betamax', label: 'Lecteurs Betamax' },
            ]
          },
          {
            id: 'electronics_tv_accessories',
            label: 'Accessoires TV et home cinema',
            children: [
              { id: 'electronics_tv_accessories_all', label: 'Tous' },
              { id: 'electronics_tv_accessories_projector_mounts', label: 'Supports et pieds pour projecteurs' },
              { id: 'electronics_tv_accessories_screens', label: 'Écrans de projection' },
              { id: 'electronics_tv_accessories_remotes', label: 'Télécommandes' },
            ]
          },
        ]
      },
      {
        id: 'electronics_beauty',
        label: 'Produits de beauté et de soins personnels',
        children: [
          { id: 'electronics_beauty_all', label: 'Tous' },
          {
            id: 'electronics_beauty_hair',
            label: 'Appareils de coiffure',
            children: [
              { id: 'electronics_beauty_hair_all', label: 'Tous' },
              { id: 'electronics_beauty_hair_dryers', label: 'Sèche-cheveux' },
              { id: 'electronics_beauty_hair_straighteners', label: 'Lisseurs' },
              { id: 'electronics_beauty_hair_curlers', label: 'Fers à boucler' },
              { id: 'electronics_beauty_hair_other', label: 'Autres appareils de coiffure' },
            ]
          },
          {
            id: 'electronics_beauty_devices',
            label: 'Appareils de beauté',
            children: [
              { id: 'electronics_beauty_devices_all', label: 'Tous' },
              { id: 'electronics_beauty_devices_led', label: 'Masques LED' },
              { id: 'electronics_beauty_devices_brushes', label: "Brosses nettoyantes et appareils d'exfoliation" },
              { id: 'electronics_beauty_devices_pens', label: 'Stylos de beauté' },
            ]
          },
          {
            id: 'electronics_beauty_shaving',
            label: 'Rasage et épilation',
            children: [
              { id: 'electronics_beauty_shaving_all', label: 'Tous' },
              { id: 'electronics_beauty_shaving_ipl', label: 'Épilateurs à lumière pulsée' },
              { id: 'electronics_beauty_shaving_epilators', label: 'Épilateurs électriques' },
              { id: 'electronics_beauty_shaving_trimmers', label: 'Tondeuses' },
              { id: 'electronics_beauty_shaving_nose', label: 'Tondeuses nez' },
              { id: 'electronics_beauty_shaving_razors', label: 'Rasoirs électriques' },
            ]
          },
          {
            id: 'electronics_beauty_massage',
            label: 'Appareils de massage',
            children: [
              { id: 'electronics_beauty_massage_all', label: 'Tous' },
              { id: 'electronics_beauty_massage_face', label: 'Appareils de massage pour le visage' },
              { id: 'electronics_beauty_massage_guns', label: 'Pistolets de massage' },
              { id: 'electronics_beauty_massage_belts', label: 'Ceintures de massage' },
              { id: 'electronics_beauty_massage_infrared', label: 'Appareils de massage à infrarouge' },
            ]
          },
          {
            id: 'electronics_beauty_dental',
            label: "Appareils d'hygiène bucco-dentaire",
            children: [
              { id: 'electronics_beauty_dental_all', label: 'Tous' },
              { id: 'electronics_beauty_dental_toothbrushes', label: 'Brosses à dents électriques' },
              { id: 'electronics_beauty_dental_flossers', label: 'Jets dentaires' },
              { id: 'electronics_beauty_dental_parts', label: 'Pièces de rechange pour brosses à dents électriques' },
            ]
          },
          {
            id: 'electronics_beauty_nails',
            label: 'Appareils de soin des ongles',
            children: [
              { id: 'electronics_beauty_nails_all', label: 'Tous' },
              { id: 'electronics_beauty_nails_manicure', label: 'Appareils de manucure et de pédicure' },
              { id: 'electronics_beauty_nails_dryers', label: 'Sèche-ongles' },
              { id: 'electronics_beauty_nails_uv', label: 'Lampes UV pour ongles' },
            ]
          },
          { id: 'electronics_beauty_scales', label: 'Pèse-personnes' },
        ]
      },
      {
        id: 'electronics_wearables',
        label: 'Objets connectés',
        children: [
          { id: 'electronics_wearables_all', label: 'Tous' },
          { id: 'electronics_wearables_smartwatches', label: 'Montres connectées' },
          { id: 'electronics_wearables_fitnessbands', label: 'Bracelets connectés' },
          { id: 'electronics_wearables_smartglasses', label: 'Lunettes connectées' },
          { id: 'electronics_wearables_smartrings', label: 'Bagues connectées' },
          { id: 'electronics_wearables_bands', label: 'Bracelets de remplacement' },
          { id: 'electronics_wearables_cases', label: 'Coques pour montres connectées' },
        ]
      },
      {
        id: 'electronics_other',
        label: 'Autres appareils et accessoires',
        children: [
          { id: 'electronics_other_all', label: 'Tous' },
          {
            id: 'electronics_other_3dprinting',
            label: 'Impression et numérisation 3D',
            children: [
              { id: 'electronics_other_3dprinting_all', label: 'Tous' },
              { id: 'electronics_other_3dprinting_printers', label: 'Imprimantes 3D' },
              { id: 'electronics_other_3dprinting_scanners', label: 'Scanners 3D' },
              { id: 'electronics_other_3dprinting_pens', label: 'Stylos 3D' },
              { id: 'electronics_other_3dprinting_filaments', label: 'Filaments pour imprimantes 3D' },
              { id: 'electronics_other_3dprinting_parts', label: 'Pièces de rechange pour imprimantes 3D' },
            ]
          },
          { id: 'electronics_other_gps', label: 'GPS et appareils de navigation par satellite' },
          { id: 'electronics_other_trackers', label: "Localisateurs d'objets" },
          { id: 'electronics_other_luggage_scales', label: 'Pèse-bagages' },
          { id: 'electronics_other_adapters', label: 'Adaptateurs' },
          { id: 'electronics_other_cables', label: 'Câbles' },
          { id: 'electronics_other_chargers', label: 'Chargeurs' },
          { id: 'electronics_other_powerbanks', label: 'Batteries externes' },
          { id: 'electronics_other_surge', label: 'Multiprises parasurtenseurs' },
          {
            id: 'electronics_other_batteries',
            label: 'Piles et alimentations',
            children: [
              { id: 'electronics_other_batteries_all', label: 'Tous' },
              { id: 'electronics_other_batteries_disposable', label: 'Piles jetables' },
              { id: 'electronics_other_batteries_rechargeable', label: 'Piles rechargeables' },
              { id: 'electronics_other_batteries_chargers', label: 'Chargeurs de piles' },
              { id: 'electronics_other_batteries_pdu', label: "Unités de distribution d'énergie" },
              { id: 'electronics_other_batteries_ups', label: 'Onduleurs' },
            ]
          },
          { id: 'electronics_other_accessories', label: 'Autres accessoires' },
        ]
      },
    ]
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Find a category node by its ID (recursive search)
 */
export function findCategoryById(id: string, nodes: CategoryNode[] = CATEGORIES): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findCategoryById(id, node.children);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get the full path of IDs from root to a category
 */
export function getCategoryPath(id: string, nodes: CategoryNode[] = CATEGORIES, path: string[] = []): string[] | null {
  for (const node of nodes) {
    const currentPath = [...path, node.id];
    if (node.id === id) return currentPath;
    if (node.children) {
      const found = getCategoryPath(id, node.children, currentPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get labels from an array of category IDs
 */
export function getCategoryLabelFromIds(ids: string[], separator = ' > '): string {
  if (!ids || ids.length === 0) return '';
  const labels: string[] = [];
  for (const id of ids) {
    const category = findCategoryById(id);
    if (category) {
      labels.push(category.label);
    }
  }
  return labels.join(separator);
}

/**
 * Get the leaf (most specific) category label
 */
export function getLeafCategoryLabel(ids: string[]): string {
  if (!ids || ids.length === 0) return '';
  const lastId = ids[ids.length - 1];
  const category = findCategoryById(lastId);
  return category ? category.label : '';
}

/**
 * Flatten all categories into a list with full paths (for AI/search)
 */
export interface FlatCategory {
  id: string;
  label: string;
  fullLabel: string;
  path: string[];
  gender: 'women' | 'men' | 'kids' | 'unisex';
  depth: number;
}

export function flattenCategories(nodes: CategoryNode[] = CATEGORIES, path: string[] = [], labels: string[] = []): FlatCategory[] {
  const result: FlatCategory[] = [];

  for (const node of nodes) {
    const currentPath = [...path, node.id];
    const currentLabels = [...labels, node.label];

    // Determine gender from root
    let gender: 'women' | 'men' | 'kids' | 'unisex' = 'unisex';
    if (currentPath[0] === 'women') gender = 'women';
    else if (currentPath[0] === 'men') gender = 'men';
    else if (currentPath[0] === 'kids') gender = 'kids';

    result.push({
      id: node.id,
      label: node.label,
      fullLabel: currentLabels.join(' > '),
      path: currentPath,
      gender,
      depth: currentPath.length,
    });

    if (node.children) {
      result.push(...flattenCategories(node.children, currentPath, currentLabels));
    }
  }

  return result;
}

// Pre-computed flat list for performance
export const FLAT_CATEGORIES = flattenCategories();

/**
 * Find flat category by ID
 */
export function findFlatCategoryById(id: string): FlatCategory | undefined {
  return FLAT_CATEGORIES.find(cat => cat.id === id);
}

/**
 * Get all leaf categories (categories without children)
 */
export function getLeafCategories(): FlatCategory[] {
  const parentIds = new Set<string>();

  for (const cat of FLAT_CATEGORIES) {
    if (cat.path.length > 1) {
      // All except the last element are parents
      for (let i = 0; i < cat.path.length - 1; i++) {
        parentIds.add(cat.path[i]);
      }
    }
  }

  return FLAT_CATEGORIES.filter(cat => !parentIds.has(cat.id));
}

/**
 * Generate category prompt section for AI (Gemini) - FULL LIST
 * Warning: This generates a lot of tokens!
 */
export function generateCategoryPromptSection(): string {
  const leafCategories = getLeafCategories();
  return leafCategories.map(cat => `  - "${cat.id}" = ${cat.fullLabel}`).join('\n');
}

// ============================================
// HIERARCHICAL CATEGORY FUNCTIONS (Token-optimized)
// ============================================

/**
 * Top-level category descriptions for Step 1 identification
 */
// MODE UNIQUEMENT - App de vente de vêtements/accessoires
export const TOP_LEVEL_CATEGORIES = [
  { id: 'women', label: 'Femmes', description: 'Vêtements, chaussures, sacs, accessoires mode femmes' },
  { id: 'men', label: 'Hommes', description: 'Vêtements, chaussures, sacs, accessoires mode hommes' },
  { id: 'kids', label: 'Enfants', description: 'Vêtements, chaussures, accessoires mode enfants/bébés' },
];

/**
 * Generate compact prompt for Step 1: Top-level category identification
 * ~150 tokens only
 */
export function generateStep1Prompt(): string {
  const categories = TOP_LEVEL_CATEGORIES.map(c =>
    `"${c.id}" = ${c.label} (${c.description})`
  ).join('\n');

  return `Identifie la catégorie principale de cet article parmi:
${categories}

Réponds UNIQUEMENT avec un JSON: {"topCategory": "ID", "confidence": 0.0-1.0}`;
}

/**
 * Get all subcategories for a top-level category (flattened)
 */
export function getSubcategoriesForTopLevel(topLevelId: string): FlatCategory[] {
  return FLAT_CATEGORIES.filter(cat =>
    cat.path[0] === topLevelId && cat.path.length > 1
  );
}

/**
 * Get leaf categories for a specific top-level category
 */
export function getLeafCategoriesForTopLevel(topLevelId: string): FlatCategory[] {
  const subcategories = getSubcategoriesForTopLevel(topLevelId);
  const parentIds = new Set<string>();

  for (const cat of subcategories) {
    for (let i = 0; i < cat.path.length - 1; i++) {
      parentIds.add(cat.path[i]);
    }
  }

  return subcategories.filter(cat => !parentIds.has(cat.id));
}

/**
 * Generate ULTRA-COMPACT category prompt for Step 2
 * Just labels - we fuzzy match to IDs on backend
 */
export function generateStep2CategoryPrompt(topLevelId: string): string {
  const leafCategories = getLeafCategoriesForTopLevel(topLevelId);

  // Just return unique leaf labels, comma separated
  const labels = [...new Set(leafCategories.map(cat => cat.label))];
  return labels.join(', ');
}

/**
 * Find category by label (fuzzy match for LLM responses)
 */
export function findCategoryByLabel(label: string, topLevelId?: string): FlatCategory | undefined {
  const normalized = label.toLowerCase().trim();
  const candidates = topLevelId
    ? getLeafCategoriesForTopLevel(topLevelId)
    : getLeafCategories();

  // Exact match first
  let match = candidates.find(cat => cat.label.toLowerCase() === normalized);
  if (match) return match;

  // Partial match
  match = candidates.find(cat =>
    cat.label.toLowerCase().includes(normalized) ||
    normalized.includes(cat.label.toLowerCase())
  );
  return match;
}

/**
 * Count tokens (rough estimate: ~4 chars per token)
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generate ULTRA-COMPACT category prompt for single-step analysis
 * Groups categories by top-level and shows only unique labels
 * ~500 tokens instead of ~37,000!
 */
export function generateCompactCategoryPrompt(): string {
  const sections: string[] = [];

  for (const topCat of TOP_LEVEL_CATEGORIES) {
    const leafCategories = getLeafCategoriesForTopLevel(topCat.id);
    // Get unique labels only (no IDs, no paths)
    const uniqueLabels = [...new Set(leafCategories.map(cat => cat.label))];
    sections.push(`${topCat.label}: ${uniqueLabels.join(', ')}`);
  }

  return sections.join('\n');
}

/**
 * Find category by label with improved fuzzy matching
 * Handles common LLM variations and typos
 */
export function findCategoryByLabelFuzzy(label: string, topLevelHint?: string): FlatCategory | undefined {
  if (!label) return undefined;

  const normalized = label.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove accents

  // Determine candidates based on hint
  let candidates: FlatCategory[];
  if (topLevelHint && ['women', 'men', 'kids'].includes(topLevelHint)) {
    candidates = getLeafCategoriesForTopLevel(topLevelHint);
  } else {
    candidates = getLeafCategories();
  }

  // 1. Exact match on label
  let match = candidates.find(cat =>
    cat.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized
  );
  if (match) return match;

  // 2. Label starts with input
  match = candidates.find(cat =>
    cat.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith(normalized)
  );
  if (match) return match;

  // 3. Input starts with label
  match = candidates.find(cat => {
    const catLabel = cat.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return normalized.startsWith(catLabel) && catLabel.length > 3;
  });
  if (match) return match;

  // 4. Contains match (both directions)
  match = candidates.find(cat => {
    const catLabel = cat.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return catLabel.includes(normalized) || normalized.includes(catLabel);
  });
  if (match) return match;

  // 5. Word overlap match - STRICTER VERSION to avoid false positives
  // Only match if words are significant (>4 chars) and represent real fashion terms
  const fashionKeywords = new Set([
    // Vêtements généraux
    'pantalon', 'pantalons', 'jeans', 'jean', 'robe', 'robes', 'jupe', 'jupes',
    'chemise', 'chemises', 'tshirt', 'shirt', 'haut', 'hauts', 'tops',
    'veste', 'vestes', 'manteau', 'manteaux', 'blouson', 'blousons', 'blazer', 'blazers',
    'pull', 'pulls', 'sweat', 'sweats', 'hoodie', 'cardigan', 'cardigans',
    'short', 'shorts', 'bermuda', 'bermudas',
    // Sous-vêtements - IMPORTANT pour éviter les faux positifs
    'sous-vetement', 'sous-vetements', 'underwear', 'calecon', 'calecons', 'boxer', 'boxers',
    'slip', 'slips', 'culotte', 'culottes', 'soutien-gorge', 'brassiere', 'lingerie',
    'pyjama', 'pyjamas', 'nuisette', 'body', 'bodies',
    // Chaussures
    'chaussure', 'chaussures', 'basket', 'baskets', 'sneaker', 'sneakers',
    'botte', 'bottes', 'bottine', 'bottines', 'sandale', 'sandales',
    'escarpin', 'escarpins', 'mocassin', 'mocassins', 'derby', 'derbies',
    // Accessoires
    'sacs', 'pochette', 'pochettes', 'ceinture', 'ceintures',
    'chapeau', 'chapeaux', 'casquette', 'casquettes', 'bonnet', 'bonnets',
    'echarpe', 'echarpes', 'foulard', 'foulards', 'gant', 'gants',
    'bijou', 'bijoux', 'collier', 'colliers', 'bracelet', 'bracelets', 'bague', 'bagues',
    'montre', 'montres', 'lunettes', 'cravate', 'cravates',
    // Maillots
    'maillot', 'maillots', 'bikini', 'bikinis', 'swimwear',
    // Sport
    'legging', 'leggings', 'jogging', 'joggings', 'survetement', 'sportswear',
  ]);

  const inputWords = normalized.split(/\s+/).filter(w => w.length > 3);

  // Only proceed if we have fashion-related words
  const hasFashionWord = inputWords.some(w => fashionKeywords.has(w));

  if (hasFashionWord) {
    match = candidates.find(cat => {
      const catWords = cat.label.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/).filter(w => w.length > 3);
      // Require exact word match with a fashion keyword
      return inputWords.some(w => catWords.includes(w) && fashionKeywords.has(w));
    });
    if (match) return match;
  }

  // 6. Fallback: Reject non-fashion terms to avoid misclassification
  const nonFashionTerms = ['table', 'chaise', 'meuble', 'lampe', 'vase', 'livre', 'jouet',
    'electromenager', 'cuisine', 'jardin', 'outil', 'voiture', 'velo', 'telephone', 'ordinateur',
    'tablette', 'bureau', 'canape', 'lit', 'armoire', 'commode'];
  if (nonFashionTerms.some(term => normalized.includes(term))) {
    console.log(`[categories] Rejected non-fashion term: "${label}"`);
    return undefined;
  }

  // Return undefined instead of a potentially wrong match
  console.log(`[categories] No fuzzy match found for: "${label}"`);
  return undefined;
}

/**
 * Get category stats for debugging
 */
export function getCategoryStats() {
  const fullPrompt = generateCategoryPromptSection();
  const step1Prompt = generateStep1Prompt();

  const stats: Record<string, number> = {
    fullPromptTokens: estimateTokenCount(fullPrompt),
    step1Tokens: estimateTokenCount(step1Prompt),
  };

  for (const topCat of TOP_LEVEL_CATEGORIES) {
    const step2Prompt = generateStep2CategoryPrompt(topCat.id);
    stats[`step2_${topCat.id}_tokens`] = estimateTokenCount(step2Prompt);
  }

  return stats;
}
