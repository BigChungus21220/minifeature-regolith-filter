let Validator = require("jsonschema").Validator;
const fs = require("fs");
const path = require("path");
const jsonc = require("jsonc");
const yaml = require("yaml");

const filter_dir = process.env.FILTER_DIR;
if (filter_dir === undefined){
  throw new Error("FILTER_DIR not defined");
}

//q

// constants

const features_dir = "./BP/features";
const minifeatures_dir = "./BP/minifeatures";
const feature_rules_dir = "./BP/feature_rules";
const schema_dir = filter_dir + "/schemas";

const path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*/)*([a-z_][a-z0-9_]*)$");
const simple_path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)/([a-z_][a-z0-9_]*)$");
const ref_pattern = new RegExp("^(([a-z_][a-z0-9_]*)\\.)?([a-z_][a-z0-9_]*)$");

const entrypoint = "feature_file.schema.json";



let namespaces = {};

// splits a feature path into its parts
function path_split(path) {
  const match = path.match(simple_path_pattern);
  const [, pack, namespace, name] = match;
  return [pack, namespace, name];
}

// converts a feature reference to a feature path
function ref_to_path(ref, namespace) {
  if (!path_pattern.test(ref)) {
    const match = ref.match(ref_pattern);
    if (match) {
      const [, , ref_namespace, ref_name] = match;
      if (ref_namespace === undefined) {
        return [`minifeature:${namespace}/${ref_name}`, "local"];
      } else {
        return `minifeature:${ref_namespace}/${ref_name}`, "namespaced";
      }
    } else {
      console.error(`Invalid feature reference: ${ref}`);
    }
  }
  return [ref, "path"];
}

// writes a feature to its respective path
function write_path(base_dir, namespace, name, object) {
  if (!fs.existsSync(base_dir)) {
    fs.mkdirSync(base_dir);
  }
  const dir_path = `${base_dir}/${namespace}`;
  if (!fs.existsSync(dir_path)) {
    fs.mkdirSync(dir_path);
  }
  let fd = fs.openSync(`${dir_path}/${name}.json`, 'w');
  fs.writeFileSync(fd, JSON.stringify(object, null, 4));
  fs.closeSync(fd);
}

// run a function on all file contents in a directory
function forEachFile(directory, fn, recursive=false){
  let files = fs.readdirSync(directory);
  
  files.forEach((file) => {
    const filePath = path.join(directory, file);
    const stat = fs.statSync(filePath);
    if (recursive && stat.isDirectory()) {
      forEachFile(filePath, fn, max_depth, depth + 1);
    } else if (stat.isFile()) {
      const data = fs.readFileSync(filePath, "utf8");
      fn(data, file);
    }
  });
}

// makes all whitespace in an object's string single spaces
function normalizeWhitespace(obj) {
  if (typeof obj === 'string') {
    return obj.replaceAll(/([\s]|(\\n))+/g, ' ');
  } else if (Array.isArray(obj)) {
    return obj.map(normalizeWhitespace);
  } else if (typeof obj === 'object' && obj !== null) {
    const result = {};
    for (const key in obj) {
      result[key] = normalizeWhitespace(obj[key]);
    }
    return result;
  } else {
    return obj;
  }
}


// load schema files & locate schema entrypoint

let val = new Validator();

let schema = undefined;

forEachFile(schema_dir, (data, filename) => {
  let json = JSON.parse(data);
  json["$id"] = filename;
  val.addSchema(json, filename);
  if (filename === entrypoint) {
    schema = json;
  }
}, true);


// read feature files, validate, map

// list of top-level feature paths (normalized)
// full paths ie: pack:dir/file
let featureList = new Set();

let success = true;

if (!fs.existsSync(minifeatures_dir)){
  process.exit(0);
}


forEachFile(minifeatures_dir, (data, filename) => {
  const filetype = filename.split('.').pop();

  // parse feature

  let feature;
  if (filetype === "yaml"){
    try {
      feature = yaml.parse(data);
    } catch (err) {
      console.error(`Error parsing YAML from ${filename}:`, err);
      success = false;
      return;
    }
  } else if (filetype === "json" || filetype === "jsonc") {
    try {
      feature = jsonc.parse(data);
    } catch (err) {
      console.error(`Error parsing JSON from ${filename}:`, err);
      success = false;
      return;
    }
  } else {
    console.error(`Unexpected feature filetype in ${filename}: ${filetype}`);
    success = false;
    return;
  }

  // validate feature
  
  const errors = val.validate(feature, schema).errors;
  if (errors.length != 0) {
    console.error(`Schema validation failed on ${filename}. Error(s):`);
    errors.forEach((error) => {
      console.error(error.stack);
    });
    success = false;
    return;
  }

  // register feature
  
  let namespace = feature.namespace;
  delete feature.namespace;
  namespaces[namespace] = {};
  
  for (const key in feature) {
    const [path, ] = ref_to_path(key, namespace);
    if (featureList.has(path)) {
      console.error(`Duplicate feature, ${child_path}`);
      success = false;
    } else {
      featureList.add(path);
    }
    namespaces[namespace][path] = feature[key];
  }

  // remove excess whitespace and newlines in strings

  feature = normalizeWhitespace(feature);
}, true);


// scan vanilla features & rules in this pack

function addFeature(data, file){
  let feature;

  try {
    feature = jsonc.parse(data);
  } catch (err) {
    console.error(`Error parsing JSON from ${file}:`, err);
    success = false;
    return;
  }

  // find the feature identifier
  let identifier;
  for (const key in feature) {
    if (key !== 'format_version') {
      const feature_def = feature[key];
      if (feature_def && typeof feature_def === 'object' && feature_def.description && typeof feature_def.description.identifier === 'string') {
        identifier = feature_def.description.identifier;
      } else {
        console.error(`Failed to locate feature identifier in ${file}`);
        success = false;
        return;
      }
    }
  }

  // add the feature to the feature list
  if (identifier){
    if (featureList.has(identifier)){
      console.error(`Duplicate feature, ${identifier}`);
      success = false;
      return;
    } else {
      featureList.add(identifier);
    }
  }
}

if (fs.existsSync(features_dir)){
  forEachFile(features_dir, addFeature, true);
}
if (fs.existsSync(feature_rules_dir)){
  forEachFile(feature_rules_dir, addFeature, true);
}


if (!success){
  throw new Error("Error(s) encountered while reading features, exiting.");
}


// define features

function ref_normalize(ref, path, namespace, index=0) {
  if (typeof ref === "string") {
    // convert reference to path
    [ref, ref_type] = ref_to_path(ref, namespace);

    // check that referenced feature exists
    if (!featureList.has(ref)) {
      if (ref_type == "path"){
        console.warn(`Feature ${ref} not found locally. This feature may not exist.`);
      } else {
        console.error(`Feature ${ref} not found.`);
      }
    }

    return ref;
  } else {
    const child_path = `${path}_${index}`;
    if (featureList.has(child_path)) {
      console.error(`Duplicate feature, ${child_path}`);
    } else {
      featureList.add(child_path);
      getFeatureType(ref).flatten(ref, child_path);
    }
    return child_path;
  }
}

// returns the feature type of a feature from the registry
function getFeatureType(feature){
  const featureType = featureRegistry[feature.type];
  if (featureType){
    return featureType;
  }
  throw new Error(`Feature type "${feature.type}" does not exist.`);
}


const featureRegistry = {
  rule: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.places = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path,
        places_feature: feature.places
      };
      delete feature.type;
      delete feature.places;

      write_path(feature_rules_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:feature_rules": feature
      });
    }
  },

  aggregate: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.features = [];
      let i = 0;
      feature.places.forEach((ref) => {
        feature.features.push(ref_normalize(ref, path, namespace, i));
        i++;
      });
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:aggregate_feature": feature
      });
    }
  },

  block: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.description = {
        identifier: path
      };
      delete feature.type;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:single_block_feature": feature
      });
    }
  },

  scatter: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.places_feature = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:scatter_feature": feature
      });
    }
  }
};


// split features into files & convert to correct format

for (const namespace in namespaces) {
  for (const key in namespaces[namespace]) {
    const feature = namespaces[namespace][key];
    getFeatureType(feature).flatten(feature, key);
  }
}


// remove minifeatures directory

fs.rmSync(minifeatures_dir, {recursive: true});