import React from 'react';
import PipelineChecklist from './PipelineChecklist';
import { WEBSITE_PIPELINE } from '../data/websitePipeline';

export default function WebsitePipelineChecklist({ project }) {
  return (
    <PipelineChecklist
      projectId={project?.id}
      pipelineDocId="website"
      data={WEBSITE_PIPELINE}
    />
  );
}
