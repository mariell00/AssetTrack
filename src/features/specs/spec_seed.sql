-- ============================================================
-- SPEC_DEFINITION — Category-driven spec fields for ASSET
-- Run once during app setup: sqlite3 registry.db < spec_seed.sql
-- ============================================================

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS SPEC_DEFINITION (
  spec_def_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL,
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL,           -- text | number | select | boolean | date
  options       TEXT,                    -- JSON array string for select fields
  unit          TEXT,                    -- optional suffix (GB, cm, W, etc.)
  is_required   INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL,
  UNIQUE(category, field_key)
);

-- ------------------------------------------------------------
-- laptop
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('laptop', 'processor',    'Processor',              'text',    NULL, NULL, 1, 1),
('laptop', 'ram',          'RAM',                    'number',  NULL, 'GB', 1, 2),
('laptop', 'storage',      'Storage',                'number',  NULL, 'GB', 1, 3),
('laptop', 'storage_type', 'Storage Type',           'select',  '["SSD","HDD","eMMC"]', NULL, 0, 4),
('laptop', 'display_size', 'Display Size',           'number',  NULL, 'in', 1, 5),
('laptop', 'os',           'Operating System',       'select',  '["Windows 11 Home","Windows 11 Pro","Windows 10","macOS","Linux"]', NULL, 0, 6),
('laptop', 'color',        'Color',                  'text',    NULL, NULL, 0, 7),
('laptop', 'battery',      'Battery',                'text',    NULL, NULL, 0, 8),
('laptop', 'mouse',        'Mouse (attached)',       'text',    NULL, NULL, 0, 9),
('laptop', 'mousepad',     'Mousepad (attached)',    'text',    NULL, NULL, 0, 10),
('laptop', 'bag',          'Bag (attached)',         'text',    NULL, NULL, 0, 11);

-- ------------------------------------------------------------
-- tablet
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('tablet', 'os',            'Operating System',      'select',  '["Android 12","Android 13","Android 14","iPadOS"]', NULL, 1, 1),
('tablet', 'screen_size',   'Screen Size',           'number',  NULL, 'in', 1, 2),
('tablet', 'resolution',    'Resolution',            'text',    NULL, NULL, 0, 3),
('tablet', 'ram',           'RAM',                   'number',  NULL, 'GB', 1, 4),
('tablet', 'storage',       'Storage',               'number',  NULL, 'GB', 1, 5),
('tablet', 'rear_camera',   'Rear Camera',           'number',  NULL, 'MP', 0, 6),
('tablet', 'front_camera',  'Front Camera',          'number',  NULL, 'MP', 0, 7),
('tablet', 'battery',       'Battery',               'number',  NULL, 'mAh', 0, 8),
('tablet', 'color',         'Color',                 'text',    NULL, NULL, 0, 9);

-- ------------------------------------------------------------
-- desktop_aio
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('desktop_aio', 'processor',    'Processor',             'text',    NULL, NULL, 1, 1),
('desktop_aio', 'ram',          'RAM',                   'number',  NULL, 'GB', 1, 2),
('desktop_aio', 'storage',      'Storage',               'number',  NULL, 'GB', 1, 3),
('desktop_aio', 'storage_type', 'Storage Type',          'select',  '["SSD","HDD","M.2 SSD"]', NULL, 0, 4),
('desktop_aio', 'display_size', 'Display Size',          'number',  NULL, 'in', 1, 5),
('desktop_aio', 'os',           'Operating System',      'select',  '["Windows 11 Home","Windows 11 Pro","Windows 10"]', NULL, 0, 6),
('desktop_aio', 'keyboard',     'Keyboard (attached)',   'text',    NULL, NULL, 0, 7),
('desktop_aio', 'mouse',        'Mouse (attached)',      'text',    NULL, NULL, 0, 8),
('desktop_aio', 'mousepad',     'Mousepad (attached)',   'text',    NULL, NULL, 0, 9),
('desktop_aio', 'ups',          'UPS (attached)',        'text',    NULL, NULL, 0, 10);

-- ------------------------------------------------------------
-- printer
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('printer', 'function',       'Function',          'select',  '["Print","Print/Scan/Copy","Print/Scan/Copy/Fax"]', NULL, 1, 1),
('printer', 'has_adf',        'Has ADF',           'boolean', NULL, NULL, 0, 2),
('printer', 'max_paper_size', 'Max Paper Size',    'select',  '["A4","Legal","A3"]', NULL, 1, 3),
('printer', 'max_resolution', 'Max Resolution',    'text',    NULL, 'dpi', 0, 4),
('printer', 'connectivity',   'Connectivity',      'select',  '["USB","WiFi","Ethernet","USB + WiFi","USB + WiFi + Ethernet"]', NULL, 1, 5),
('printer', 'print_speed',    'Print Speed',       'text',    NULL, 'ipm', 0, 6),
('printer', 'color',          'Color',             'text',    NULL, NULL, 0, 7);

-- ------------------------------------------------------------
-- projector
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('projector', 'technology',           'Technology',           'select',  '["DLP","3LCD","LCD"]', NULL, 1, 1),
('projector', 'brightness',           'Brightness',           'number',  NULL, 'lumens', 1, 2),
('projector', 'native_resolution',    'Native Resolution',    'select',  '["XGA","WXGA","SVGA","1080p","4K"]', NULL, 1, 3),
('projector', 'wireless_projection',  'Wireless Projection',  'boolean', NULL, NULL, 0, 4),
('projector', 'color',                'Color',                'text',    NULL, NULL, 0, 5),
('projector', 'bag',                  'Bag (attached)',       'text',    NULL, NULL, 0, 6),
('projector', 'screen',               'Screen (attached)',    'text',    NULL, NULL, 0, 7),
('projector', 'remote',               'Remote (attached)',    'boolean', NULL, NULL, 0, 8);

-- ------------------------------------------------------------
-- scanner
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('scanner', 'type',         'Type',         'select',  '["Sheet-fed","Flatbed"]', NULL, 1, 1),
('scanner', 'duplex',       'Duplex',       'boolean', NULL, NULL, 0, 2),
('scanner', 'connectivity', 'Connectivity', 'select',  '["USB","WiFi","Ethernet","USB + WiFi + Ethernet"]', NULL, 1, 3),
('scanner', 'color',        'Color',        'text',    NULL, NULL, 0, 4);

-- ------------------------------------------------------------
-- camera_drone
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('camera_drone', 'subtype',           'Subtype',              'select',  '["Camera","Drone"]', NULL, 1, 1),
('camera_drone', 'megapixels',        'Megapixels',           'number',  NULL, 'MP', 0, 2),
('camera_drone', 'lens',              'Lens',                 'text',    NULL, NULL, 0, 3),
('camera_drone', 'max_resolution',    'Max Resolution',       'select',  '["1080p","4K"]', NULL, 0, 4),
('camera_drone', 'flight_time',       'Flight Time',          'number',  NULL, 'min', 0, 5),
('camera_drone', 'transmission_range','Transmission Range',   'number',  NULL, 'm', 0, 6),
('camera_drone', 'features',          'Features',             'text',    NULL, NULL, 0, 7),
('camera_drone', 'storage_media',     'Storage Media',        'text',    NULL, NULL, 0, 8),
('camera_drone', 'battery',           'Battery (attached)',   'text',    NULL, NULL, 0, 9),
('camera_drone', 'charger',           'Charger (attached)',   'boolean', NULL, NULL, 0, 10),
('camera_drone', 'strap',             'Strap (attached)',     'boolean', NULL, NULL, 0, 11),
('camera_drone', 'bag',               'Bag (attached)',       'text',    NULL, NULL, 0, 12),
('camera_drone', 'controller',        'Controller (attached)','text',    NULL, NULL, 0, 13);

-- ------------------------------------------------------------
-- audio_visual
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('audio_visual', 'subtype',      'Subtype',             'select',  '["Speaker","Mixer","Microphone","Webcam","Cable","Recorder"]', NULL, 1, 1),
('audio_visual', 'power_output', 'Power Output',        'number',  NULL, 'W', 0, 2),
('audio_visual', 'channels',     'Channels',            'number',  NULL, NULL, 0, 3),
('audio_visual', 'connectivity', 'Connectivity',        'select',  '["USB","XLR","Bluetooth","3.5mm","RCA"]', NULL, 0, 4),
('audio_visual', 'length',       'Cable Length',        'number',  NULL, 'm', 0, 5),
('audio_visual', 'color',        'Color',               'text',    NULL, NULL, 0, 6),
('audio_visual', 'stand',        'Stand (attached)',    'text',    NULL, NULL, 0, 7),
('audio_visual', 'batteries',    'Batteries (attached)','text',    NULL, NULL, 0, 8);

-- ------------------------------------------------------------
-- network_security
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('network_security', 'subtype',      'Subtype',         'select',  '["CCTV Kit","Biometric"]', NULL, 1, 1),
('network_security', 'channels',     'Channels',        'number',  NULL, NULL, 0, 2),
('network_security', 'camera_type',  'Camera Type',     'text',    NULL, NULL, 0, 3),
('network_security', 'storage',      'Storage',         'text',    NULL, NULL, 0, 4),
('network_security', 'power',        'Power',           'text',    NULL, NULL, 0, 5),
('network_security', 'cabling',      'Cabling',         'text',    NULL, NULL, 0, 6),
('network_security', 'connectivity', 'Connectivity',    'select',  '["USB","WiFi","Ethernet","WiFi + Ethernet"]', NULL, 0, 7),
('network_security', 'software',     'Software',        'text',    NULL, NULL, 0, 8),
('network_security', 'ups',          'UPS (attached)',  'text',    NULL, NULL, 0, 9);

-- ------------------------------------------------------------
-- external_storage
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('external_storage', 'capacity',    'Capacity',     'number',  NULL, 'TB', 1, 1),
('external_storage', 'interface',   'Interface',    'select',  '["USB 2.0","USB 3.0","USB 3.2 Gen 1","USB-C"]', NULL, 1, 2),
('external_storage', 'form_factor', 'Form Factor',  'select',  '["Portable","Desktop"]', NULL, 0, 3),
('external_storage', 'features',    'Features',     'text',    NULL, NULL, 0, 4),
('external_storage', 'color',       'Color',        'text',    NULL, NULL, 0, 5);

-- ------------------------------------------------------------
-- furniture
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('furniture', 'subtype',    'Subtype',     'select',  '["Chair","Table","Cabinet","Shelf","Sofa","Display Panel","Podium","Board"]', NULL, 1, 1),
('furniture', 'material',   'Material',    'text',    NULL, NULL, 0, 2),
('furniture', 'dimensions', 'Dimensions',  'text',    NULL, 'cm', 0, 3),
('furniture', 'color',      'Color',       'text',    NULL, NULL, 0, 4),
('furniture', 'capacity',   'Capacity',    'text',    NULL, NULL, 0, 5),
('furniture', 'features',   'Features',    'text',    NULL, NULL, 0, 6);

-- ------------------------------------------------------------
-- office_equipment
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('office_equipment', 'subtype',  'Subtype',   'select',  '["Shredder","Binding Machine","Paper Cutter","Stapler","Laminator","Standee","Extension Wire"]', NULL, 1, 1),
('office_equipment', 'capacity', 'Capacity',  'text',    NULL, NULL, 0, 2),
('office_equipment', 'size',     'Size',      'text',    NULL, NULL, 0, 3),
('office_equipment', 'length',   'Length',    'number',  NULL, 'm', 0, 4),
('office_equipment', 'color',    'Color',     'text',    NULL, NULL, 0, 5);

-- ------------------------------------------------------------
-- appliance
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('appliance', 'subtype',  'Subtype',   'select',  '["Water Dispenser","Coffee Maker","Refrigerator","Aircon"]', NULL, 1, 1),
('appliance', 'capacity', 'Capacity',  'text',    NULL, NULL, 0, 2),
('appliance', 'features', 'Features',  'text',    NULL, NULL, 0, 3),
('appliance', 'color',    'Color',     'text',    NULL, NULL, 0, 4);

-- ------------------------------------------------------------
-- display_tv
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('display_tv', 'screen_size', 'Screen Size',           'number',  NULL, 'in', 1, 1),
('display_tv', 'resolution',  'Resolution',            'select',  '["1080p","4K UHD","8K"]', NULL, 1, 2),
('display_tv', 'panel_type',  'Panel Type',            'select',  '["LED","LCD","OLED","QLED"]', NULL, 0, 3),
('display_tv', 'smart_tv',    'Smart TV',              'boolean', NULL, NULL, 0, 4),
('display_tv', 'soundbar',    'Soundbar (attached)',   'text',    NULL, NULL, 0, 5),
('display_tv', 'bracket',     'Bracket (attached)',    'text',    NULL, NULL, 0, 6),
('display_tv', 'remote',      'Remote (attached)',     'boolean', NULL, NULL, 0, 7);

-- ------------------------------------------------------------
-- recorder
-- ------------------------------------------------------------
INSERT INTO SPEC_DEFINITION (category, field_key, label, field_type, options, unit, is_required, display_order) VALUES
('recorder', 'storage',   'Storage',          'number',  NULL, 'GB', 1, 1),
('recorder', 'interface', 'Interface',        'select',  '["USB","USB-C"]', NULL, 1, 2),
('recorder', 'type',      'Type',             'text',    NULL, NULL, 0, 3),
('recorder', 'pouch',     'Pouch (attached)', 'boolean', NULL, NULL, 0, 4);

COMMIT;
