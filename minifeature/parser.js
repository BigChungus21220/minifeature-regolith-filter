import fs from "fs";
import Ajv from "ajv";
import jsonc from "jsonc";
import yaml from "yaml";

import {features, featureList, createFeature} from './feature.js';

import {
  schema_dir,
  forEachFile,
  template_name_pattern,
  settings
} from './utils.js';

/*
note: file structure is better thought of as one big file split into 3 for easier navigation, rather than properly separated modules
utils.js -> feature.js -> parser.js
*/

/*
High-level Procedure:
- load schemas
- load, parse, validate, and register features & templates
- register vanilla features
- recursively split features into separate files and to correct format
- delete minifeatures folder
*/

const ajv = new Ajv({strict: false});

// load schemas
forEachFile(schema_dir, (data, filename) => {
  let json = JSON.parse(data);
  json["$id"] = filename;
  ajv.addSchema(json);
}, true);


// read feature files, validate, register

let success = true;

if (!fs.existsSync(settings.minifeatures_directory)){
  process.exit(0);
}

let featureStack = [];
let templateStack = [];

forEachFile(settings.minifeatures_directory, (data, filename) => {
  const filetype = filename.split('.').pop();

  // parse feature file

  let featureFile;
  if (filetype === "yaml"){
    try {
      featureFile = yaml.parse(data);
    } catch (err) {
      console.error(`Error parsing YAML from ${filename}:`, err);
      success = false;
      return;
    }
  } else if (filetype === "json" || filetype === "jsonc") {
    try {
      featureFile = jsonc.parse(data);
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
  
  const errors = ajv.validate("feature_file.schema.json", featureFile).errors;
  if (errors) {
    console.error(`Schema validation failed on ${filename}. Error(s):`);
    errors.forEach((error) => {
      console.error(error.stack);
    });
    success = false;
    return;
  }

  // register feature
  
  let namespace = featureFile.namespace;
  delete featureFile.namespace;
  
  for (const name in featureFile) {
    if (template_name_pattern.test(name)){
      templateStack.push({name:name, namespace:namespace, object:featureFile[name]});
    } else {
      featureStack.push({name:name, namespace:namespace, object:featureFile[name]});
    }
  }
}, true);

// have to process templates first

for (let template of templateStack){
  try {
    createFeature(template.namespace, template.name, template.object);
  } catch (err) {
    console.error(err.message);
    success = false;
  }
}

for (let feature of featureStack){
  try {
    createFeature(feature.namespace, feature.name, feature.object);
  } catch (err) {
    console.error(err.message);
    success = false;
  }
}

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

if (fs.existsSync(settings.features_directory)){
  forEachFile(settings.features_directory, addFeature, true);
}
if (fs.existsSync(settings.feature_rules_directory)){
  forEachFile(settings.feature_rules_directory, addFeature, true);
}

if (!success){
  throw new Error("Error(s) encountered while registering features, exiting.");
}

// resolve features (flatten into list + resolve vars & templates)
for (const [identifier, feature] of features) {
  try {
    feature.resolve({});
  } catch (err) {
    console.error(err.message);
    success = false;
  }
}

if (!success){
  throw new Error("Error(s) encountered while expanding features, exiting.");
}

// re-validate schemas without vars or templates

// update validator to toggle templates & vars
[
  "template_ref.schema.json",
  "variable.schema.json",
  "variable_assignment.schema.json",
  "cond_ignore.schema.json"
].forEach(id => {
  ajv.removeSchema(id);
  ajv.addSchema({ "$id": id, "not": {} });
});

// re-validate
for (const [identifier, feature] of features) {
  const errors = ajv.validate("feature_ref.schema.json", feature).errors;
  if (errors){
    console.error(`Schema validation failed on ${feature.identifier} after template resolution. Error(s):`);
    errors.forEach((error) => {
      console.error(error.stack);
    });
    success = false;
    break;
  }
}

if (!success){
  throw new Error("Error(s) encountered while validating expanded features, exiting.");
}

// write features to output
for (let [identifier, feature] of features) {
  feature.writeFeature();
}

// remove minifeatures directory
fs.rmSync(settings.minifeatures_directory, {recursive: true});